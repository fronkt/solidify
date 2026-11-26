"""AWS launcher for the Q3d paper rows (scripts/research/quant3d-paper-rows.md).

Adapted from the 2026-11-25 Option B launcher. One NVIDIA L40S (g6e), Chrome
under xvfb with Vulkan. The frozen branch travels as a git bundle (no push).

Safeguards
- Spend cap: user-data `shutdown -h +N` with N = min(18 h, floor(cap / hourly rate)) and
  --instance-initiated-shutdown-behavior terminate.
- Preflight before the long run: hardware NVIDIA adapter, 9/9 slabbed-driver
  equivalence, VRAM smoke test of the largest arm. A failed preflight tears down.
- Detached remote run (nohup setsid); per-arm incremental pulls; after the remote
  finishes it waits at most 3 h for the local pull, then shuts itself down.
- Teardown: terminate + delete SG and key pair; if the SSO token has expired,
  fall back to `sudo shutdown -h now` over SSH and record the leftovers.

Usage:  python scripts/research/aws_q3d_launch.py [--dry-run]
Needs:  aws sso login --profile 83sciences-research
"""
import ctypes
import json
import math
import os
import pathlib
import subprocess
import sys
import time
import urllib.request

PROFILE = "83sciences-research"
REGION = "us-east-1"
VPC_ID = "vpc-077d401cf1d70dd26"
CAP_USD = 35.0
# On-demand us-east-1 rates (USD/h); Option B: ~$30 for 16 h on g6e.xlarge.
INSTANCES = [("g6e.xlarge", 1.861), ("g6e.2xlarge", 2.242), ("g6e.4xlarge", 3.004)]
PUB_KEY = r"C:\Users\frank\.ssh\id_ed25519.pub"
PRIV_KEY = r"C:\Users\frank\.ssh\id_ed25519"
WORKTREE = pathlib.Path(__file__).resolve().parents[2]
BRANCH = "research/q3d-paper"
RUN_DIR = pathlib.Path(r"D:\solidify\q3d-rows-2026-11-26")
STATE_FILE = RUN_DIR / "aws_q3d_state.json"
LOCAL_VAL = WORKTREE / "docs" / "validation"
# Leftovers of the 2026-11-25 Option B run (flagged for deletion in the vault note).
LEFTOVERS = {"sg": "sg-025467720d58cdb75", "key": "solidify-q3c-optb-20261124-225944"}
SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=20",
            "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-i", PRIV_KEY]
IGNORE_DEFAULT = ["--use-angle=swiftshader-webgl", "--disable-gpu", "--enable-features=PdfOopif"]
CHROME_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--enable-features=Vulkan",
               "--use-angle=vulkan", "--ignore-gpu-blocklist", "--disable-gpu-sandbox", "--disable-software-rasterizer",
               "--enable-dawn-features=allow_unsafe_apis,disable_adapter_blocklist"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def keep_awake(on=True):
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | (0x00000001 if on else 0))
    except Exception:
        pass


def save(state):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def aws(*args, parse_json=True):
    cmd = ["aws", "--profile", PROFILE, "--region", REGION, *args] + (["--output", "json"] if parse_json else [])
    r = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "MSYS_NO_PATHCONV": "1"})
    if r.returncode != 0:
        raise RuntimeError(f"aws {' '.join(args[:2])} failed ({r.returncode}): {r.stderr.strip()}")
    return json.loads(r.stdout) if parse_json and r.stdout.strip() else r.stdout.strip()


def ssh_stream(ip, script, check=True):
    p = subprocess.Popen(["ssh", *SSH_OPTS, f"ubuntu@{ip}", "bash", "-s"], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    p.stdin.write(script.replace("\r\n", "\n").encode("utf-8"))
    p.stdin.close()
    out = []
    for raw in p.stdout:
        line = raw.decode("utf-8", errors="replace")
        sys.stdout.write(line)
        sys.stdout.flush()
        out.append(line)
    rc = p.wait()
    if check and rc != 0:
        raise RuntimeError(f"ssh exited {rc}")
    return rc, "".join(out)


def ssh_quick(ip, cmd, timeout=60):
    r = subprocess.run(["ssh", *SSH_OPTS, f"ubuntu@{ip}", cmd], capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def scp_pull(ip, remote, local, check=False):
    local = pathlib.Path(local)
    local.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["scp", *SSH_OPTS, f"ubuntu@{ip}:{remote}", str(local)], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"scp {remote} failed: {r.stderr.strip()}")
    return r.returncode == 0


def teardown(state):
    log("TEARDOWN")
    iid, ip = state.get("instance_id"), state.get("public_ip")
    api_ok = True
    if iid:
        try:
            aws("ec2", "terminate-instances", "--instance-ids", iid)
            aws("ec2", "wait", "instance-terminated", "--instance-ids", iid, parse_json=False)
            log(f"terminated {iid}")
        except Exception as e:
            api_ok = False
            log(f"terminate via API failed ({e}); shutting down over SSH (instance terminates on shutdown)")
            if ip:
                try:
                    ssh_quick(ip, "sudo shutdown -h now", timeout=30)
                except Exception as e2:
                    log(f"SSH shutdown failed too: {e2}. Hard cap still stops it.")
    for kind, ident in (("sg", state.get("sg_id")), ("key", state.get("key_name"))):
        if not ident:
            continue
        done = False
        for _ in range(8 if api_ok else 1):
            try:
                if kind == "sg":
                    aws("ec2", "delete-security-group", "--group-id", ident, parse_json=False)
                else:
                    aws("ec2", "delete-key-pair", "--key-name", ident, parse_json=False)
                done = True
                break
            except Exception:
                time.sleep(5)
        state.setdefault("leftovers", {})[kind] = None if done else ident
    state["torn_down"] = True
    save(state)


def remote_script(cap_minutes):
    env = "\n".join([
        'export VK_ICD_FILENAMES="/etc/vulkan/icd.d/nvidia_icd.json"',
        'export VK_DRIVER_FILES="/etc/vulkan/icd.d/nvidia_icd.json"',
        'export CHROME_PATH="/usr/bin/google-chrome-stable"',
        "export Q3_HEADLESS=0",
        f"export Q3_IGNORE_DEFAULT_ARGS='{json.dumps(IGNORE_DEFAULT)}'",
        f"export CHROME_ARGS='{json.dumps(CHROME_ARGS)}'",
    ])
    return f"""
set -euo pipefail
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
sudo apt-get update -qq
sudo apt-get install -y -qq curl ca-certificates xvfb vulkan-tools libvulkan1 libgbm1 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 libasound2 python3-numpy python3-scipy
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi
if ! command -v google-chrome-stable >/dev/null 2>&1; then
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb
  sudo apt-get install -y -qq /tmp/chrome.deb
fi
{env}
sudo chmod 666 /dev/dri/* 2>/dev/null || true
cd /home/ubuntu
rm -rf solidify && git clone -q -b {BRANCH} /tmp/q3d.bundle solidify
cd solidify && git log --oneline -1 && npm ci --silent
mkdir -p /home/ubuntu/q3d-out
nohup setsid npx vite --host 127.0.0.1 --port 5199 --strictPort </dev/null >/tmp/vite.log 2>&1 &
for i in $(seq 1 60); do curl -sf http://127.0.0.1:5199/app/ >/dev/null && break; sleep 1; done
xvfb-run -a -s "-screen 0 1280x720x24" node scripts/research/quant3d-paper-rows.mjs /home/ubuntu/q3d-out/preflight 5199 --preflight
echo PREFLIGHT_PASS
cat > /home/ubuntu/run_q3d.sh << 'RUNEOF'
#!/bin/bash
set -uo pipefail
{env}
cd /home/ubuntu/solidify
OUT=/home/ubuntu/q3d-out
Q3_EQUILIBRIUM_MATRIX=scripts/research/quant3d-equilibrium-matrix-q3d.json timeout 7200 xvfb-run -a -s "-screen 0 1280x720x24" node scripts/research/quant3d-equilibrium.mjs $OUT/equilibrium 5199
echo "EQUILIBRIUM_EXIT=$?"
timeout {max(60, cap_minutes - 90) * 60} xvfb-run -a -s "-screen 0 1280x720x24" node scripts/research/quant3d-paper-rows.mjs $OUT/rows 5199 --run
RC=$?
echo "ROWS_EXIT=$RC"
python3 scripts/research/quant3d-q3c-tip-replay.py --campaign q3d=$OUT/rows/samples --out $OUT/replay.json
echo "REPLAY_EXIT=$?"
tar -czf /home/ubuntu/q3d-out.tar.gz -C /home/ubuntu q3d-out
echo "Q3D_WRAPPER_DONE rows=$RC"
for i in $(seq 1 180); do [ -f /home/ubuntu/PULLED ] && exit 0; sleep 60; done
sudo shutdown -h now
RUNEOF
chmod +x /home/ubuntu/run_q3d.sh
nohup setsid /home/ubuntu/run_q3d.sh </dev/null >/home/ubuntu/q3d-out/run.log 2>&1 &
echo DETACHED_LAUNCH_OK
"""


def main():
    # Remote apt/npm output contains non-cp1252 characters (e.g. U+2192); a redirected
    # Windows stdout would raise UnicodeEncodeError mid-provisioning (first launch, 11-26).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    dry = "--dry-run" in sys.argv
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    head = subprocess.run(["git", "-C", str(WORKTREE), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    # The box clones the committed branch (bundle), so only campaign files need to match HEAD;
    # the fp64 port may be mid-edit in this worktree.
    campaign = ["src", "scripts/fixtures", "scripts/browser-cleanup.mjs", "scripts/research/quant3d-paper-rows.mjs",
                "scripts/research/quant3d-paper-rows-model.mjs", "scripts/research/quant3d-paper-rows.md",
                "scripts/research/quant3d-width-ladder-model.mjs", "scripts/research/quant3d-equilibrium.mjs",
                "scripts/research/quant3d-equilibrium-driver.mjs", "scripts/research/quant3d-equilibrium-matrix-q3d.json",
                "scripts/research/quant3d-q3c-tip-replay.py", "scripts/research/aws_q3d_launch.py", "package.json", "package-lock.json"]
    dirty = subprocess.run(["git", "-C", str(WORKTREE), "status", "--porcelain", "--untracked-files=no", "--", *campaign],
                           capture_output=True, text=True, check=True).stdout.strip()
    if dirty:
        raise SystemExit(f"worktree has uncommitted tracked changes; freeze first:\n{dirty}")
    if dry:
        print(remote_script(18 * 60))
        return
    bundle = RUN_DIR / "q3d.bundle"
    subprocess.run(["git", "-C", str(WORKTREE), "bundle", "create", str(bundle), BRANCH], check=True, capture_output=True)
    ident = aws("sts", "get-caller-identity")
    log(f"AWS_OK {ident['Arn']}  frozen={head}")
    keep_awake(True)
    for kind, ident_ in LEFTOVERS.items():
        try:
            if kind == "sg":
                aws("ec2", "delete-security-group", "--group-id", ident_, parse_json=False)
            else:
                aws("ec2", "delete-key-pair", "--key-name", ident_, parse_json=False)
            log(f"deleted 11-25 leftover {kind} {ident_}")
        except Exception as e:
            log(f"11-25 leftover {kind} {ident_}: {str(e).splitlines()[-1][:160]}")
    my_ip = urllib.request.urlopen("https://checkip.amazonaws.com", timeout=15).read().decode().strip()
    ts = time.strftime("%Y%m%d-%H%M%S")
    state = {"frozen": head, "key_name": f"solidify-q3d-{ts}", "started": ts, "torn_down": False}
    save(state)
    imgs = aws("ec2", "describe-images", "--owners", "amazon", "--filters",
               "Name=name,Values=Deep Learning OSS Nvidia Driver AMI GPU PyTorch 2.* (Ubuntu 22.04)*",
               "Name=state,Values=available", "Name=architecture,Values=x86_64")["Images"]
    ami = sorted(imgs, key=lambda x: x["CreationDate"], reverse=True)[0]["ImageId"]
    try:
        aws("ec2", "import-key-pair", "--key-name", state["key_name"], "--public-key-material", f"fileb://{PUB_KEY}")
        state["sg_id"] = aws("ec2", "create-security-group", "--group-name", f"solidify-q3d-{ts}",
                             "--description", "Temp SSH for SOLIDIFY Q3d paper rows", "--vpc-id", VPC_ID)["GroupId"]
        aws("ec2", "authorize-security-group-ingress", "--group-id", state["sg_id"], "--protocol", "tcp",
            "--port", "22", "--cidr", f"{my_ip}/32", parse_json=False)
        save(state)
        subnets = aws("ec2", "describe-subnets", "--filters", f"Name=vpc-id,Values={VPC_ID}")["Subnets"]
        subnets.sort(key=lambda s: (0 if s["AvailabilityZone"].endswith("a") else 1, s["AvailabilityZone"]))
        bdm = json.dumps([{"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 120, "VolumeType": "gp3", "DeleteOnTermination": True}}])
        for itype, rate in INSTANCES:
            cap_minutes = min(18 * 60, int(math.floor(CAP_USD / rate * 60)))
            tags = json.dumps([{"ResourceType": "instance", "Tags": [{"Key": "Name", "Value": f"solidify-q3d-{ts}"},
                              {"Key": "Owner", "Value": "frank"}, {"Key": "Purpose", "Value": "SOLIDIFY-Q3d-paper-rows"}]}])
            for sub in subnets:
                try:
                    res = aws("ec2", "run-instances", "--image-id", ami, "--instance-type", itype, "--key-name", state["key_name"],
                              "--security-group-ids", state["sg_id"], "--subnet-id", sub["SubnetId"],
                              "--instance-initiated-shutdown-behavior", "terminate", "--block-device-mappings", bdm,
                              "--tag-specifications", tags, "--user-data", f"#!/bin/bash\nshutdown -h +{cap_minutes}\n")
                    state.update(instance_id=res["Instances"][0]["InstanceId"], instance_type=itype, rate=rate,
                                 cap_minutes=cap_minutes, az=sub["AvailabilityZone"])
                    save(state)
                    log(f"LAUNCHED {state['instance_id']} {itype} {sub['AvailabilityZone']} hard stop +{cap_minutes} min")
                    break
                except Exception as e:
                    log(f"TRY {itype} {sub['AvailabilityZone']}: {str(e).splitlines()[-1][:160]}")
            if state.get("instance_id"):
                break
        if not state.get("instance_id"):
            raise RuntimeError("no g6e capacity in us-east-1")
        aws("ec2", "wait", "instance-running", "--instance-ids", state["instance_id"], parse_json=False)
        ip = aws("ec2", "describe-instances", "--instance-ids", state["instance_id"])["Reservations"][0]["Instances"][0]["PublicIpAddress"]
        state["public_ip"] = ip
        save(state)
        for _ in range(40):
            rc, out = ssh_stream(ip, "echo SSH_READY", check=False)
            if rc == 0 and "SSH_READY" in out:
                break
            time.sleep(5)
        else:
            raise RuntimeError("SSH not ready")
        subprocess.run(["scp", *SSH_OPTS, str(bundle), f"ubuntu@{ip}:/tmp/q3d.bundle"], check=True)
        try:
            ssh_stream(ip, remote_script(state["cap_minutes"]))
        except Exception:
            # Keep the evidence before teardown deletes the box.
            scp_pull(ip, "/home/ubuntu/q3d-out/preflight/preflight-result.json", RUN_DIR / f"preflight-failed-{ts}.json")
            scp_pull(ip, "/tmp/vite.log", RUN_DIR / f"vite-failed-{ts}.log")
            raise
        log("PREFLIGHT PASSED, detached run launched; monitoring")
        seen, pulled, fails = 0, set(), 0
        while True:
            time.sleep(120)
            try:
                rc, out, err = ssh_quick(ip, "cat /home/ubuntu/q3d-out/run.log 2>/dev/null || true")
                if rc != 0:
                    raise RuntimeError(err.strip())
                fails = 0
            except Exception as e:
                fails += 1
                log(f"monitor ssh miss #{fails}: {e}")
                if fails >= 15:
                    raise RuntimeError("lost SSH for 30 min; the box stops itself at the hard cap")
                continue
            lines = out.splitlines()
            for ln in lines[seen:]:
                log(f"[REMOTE] {ln}")
                if ln.startswith("ARM_DONE "):
                    name = ln.split()[1]
                    if name not in pulled:
                        a = scp_pull(ip, "/home/ubuntu/q3d-out/rows/paper-rows-result.json", LOCAL_VAL / "quant3d-q3d-rows-2026-11-26.json")
                        b = scp_pull(ip, f"/home/ubuntu/q3d-out/rows/arms/{name}-samples.tar.gz", RUN_DIR / f"{name}-samples.tar.gz")
                        log(f"PULLED arm={name} json={a} tar={b}")
                        pulled.add(name)
            seen = len(lines)
            if any(ln.startswith("Q3D_WRAPPER_DONE") for ln in lines):
                scp_pull(ip, "/home/ubuntu/q3d-out/rows/paper-rows-result.json", LOCAL_VAL / "quant3d-q3d-rows-2026-11-26.json")
                scp_pull(ip, "/home/ubuntu/q3d-out/equilibrium/calibration-result.json", LOCAL_VAL / "quant3d-q3d-equilibrium-2026-11-26.json")
                scp_pull(ip, "/home/ubuntu/q3d-out/replay.json", LOCAL_VAL / "quant3d-q3d-rows-replay-2026-11-26.json")
                ok = scp_pull(ip, "/home/ubuntu/q3d-out.tar.gz", RUN_DIR / "q3d-out.tar.gz")
                if ok:
                    ssh_quick(ip, "touch /home/ubuntu/PULLED")
                log(f"FINAL_PULL archive={ok}")
                break
    finally:
        teardown(state)
        keep_awake(False)


if __name__ == "__main__":
    main()
