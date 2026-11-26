"""AWS launcher for the Q3d paper campaign (scripts/research/quant3d-paper-rows.md).

Adapted from the 2026-11-25 Option B launcher. One NVIDIA L40S (g6e) per launch. The frozen
branch travels as a git bundle (no push). Two modes, each with its own run directory, state
file, key pair and security group, so two launches can run side by side:

- rows: Chrome under xvfb with Vulkan; equilibrium matrix, the WebGPU tip arms, CPU replay.
- fp64: the NumPy/CuPy fused-kernel port (scripts/research/quant3d-fp64-port.md); box gates,
  the fp64 arms, CPU replay.

Safeguards
- Spend cap: user-data `shutdown -h +N` with N = min(18 h, floor(cap / hourly rate)) and
  --instance-initiated-shutdown-behavior terminate.
- Gates before the long run, in the foreground (a failure pulls the evidence and tears down):
  rows = hardware NVIDIA adapter, 9/9 slabbed-driver equivalence, VRAM smoke of the largest arm
  (if that smoke fails, the fallback arms run instead); fp64 = port self-test and box gates.
- Detached remote run (nohup setsid); per-arm incremental pulls; after the remote finishes it
  waits at most 3 h for the local pull, then shuts itself down.
- Teardown: terminate + delete SG and key pair; if the SSO token has expired, fall back to
  `sudo shutdown -h now` over SSH and record the leftovers.

Usage:
  python scripts/research/aws_q3d_launch.py --mode rows --tag s2-2026-11-26 \
      --arms e265cal,e123cal --fallback-arms e265cal \
      --matrix scripts/research/quant3d-equilibrium-matrix-q3d-s2.json --instances g6e.4xlarge
  python scripts/research/aws_q3d_launch.py --mode fp64 --tag s2-2026-11-26 \
      --instances g6e.xlarge,g6e.2xlarge --cap-usd 17
  (--dry-run prints the remote script; a file STOP in the run directory ends the monitor loop
  and tears down.)
Needs:  aws sso login --profile 83sciences-research
"""
import argparse
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
# On-demand us-east-1 rates (USD/h).
RATES = {"g6e.xlarge": 1.861, "g6e.2xlarge": 2.242, "g6e.4xlarge": 3.004}
PUB_KEY = r"C:\Users\frank\.ssh\id_ed25519.pub"
PRIV_KEY = r"C:\Users\frank\.ssh\id_ed25519"
WORKTREE = pathlib.Path(__file__).resolve().parents[2]
BRANCH = "research/q3d-paper"
LOCAL_VAL = WORKTREE / "docs" / "validation"
CAPTURE = WORKTREE / "verify-out" / "fp64-port" / "capture-states.tar.gz"
CAPTURE_SHA256 = "c4bb3ee61e084d40c5dcafd72c98539fa2c8063093ed18c2a70880946ef4a501"
SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=20",
            "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-i", PRIV_KEY]
IGNORE_DEFAULT = ["--use-angle=swiftshader-webgl", "--disable-gpu", "--enable-features=PdfOopif"]
CHROME_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--enable-features=Vulkan",
               "--use-angle=vulkan", "--ignore-gpu-blocklist", "--disable-gpu-sandbox", "--disable-software-rasterizer",
               "--enable-dawn-features=allow_unsafe_apis,disable_adapter_blocklist"]
FP64_ARMS = ["w40-anchor", "w28"]
STATE_FILE = None  # set in main() from --mode/--tag


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


def rows_script(cap_minutes, args):
    env = "\n".join([
        'export VK_ICD_FILENAMES="/etc/vulkan/icd.d/nvidia_icd.json"',
        'export VK_DRIVER_FILES="/etc/vulkan/icd.d/nvidia_icd.json"',
        'export CHROME_PATH="/usr/bin/google-chrome-stable"',
        "export Q3_HEADLESS=0",
        f"export Q3_IGNORE_DEFAULT_ARGS='{json.dumps(IGNORE_DEFAULT)}'",
        f"export CHROME_ARGS='{json.dumps(CHROME_ARGS)}'",
    ])
    arms = f"--arms={args.arms}" if args.arms else ""
    fallback = f"--arms={args.fallback_arms}" if args.fallback_arms else ""
    xvfb = 'xvfb-run -a -s "-screen 0 1280x720x24"'
    return f"""
set -euo pipefail
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
free -g | head -2
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
if {xvfb} node scripts/research/quant3d-paper-rows.mjs /home/ubuntu/q3d-out/preflight 5199 --preflight {arms}; then
  echo "{arms}" > /home/ubuntu/q3d-arms
  echo PREFLIGHT_PASS
else
  # v1.2: a VRAM-smoke failure of the largest arm must not cost the fallback arms.
  [ -n "{fallback}" ] || exit 1
  echo PREFLIGHT_FULL_FAILED_RETRYING_WITH_FALLBACK_ARMS
  {xvfb} node scripts/research/quant3d-paper-rows.mjs /home/ubuntu/q3d-out/preflight-small 5199 --preflight {fallback}
  echo "{fallback}" > /home/ubuntu/q3d-arms
  echo PREFLIGHT_PASS_FALLBACK
fi
cat > /home/ubuntu/run_q3d.sh << 'RUNEOF'
#!/bin/bash
set -uo pipefail
{env}
cd /home/ubuntu/solidify
OUT=/home/ubuntu/q3d-out
Q3_EQUILIBRIUM_MATRIX={args.matrix} timeout 7200 {xvfb} node scripts/research/quant3d-equilibrium.mjs $OUT/equilibrium 5199
echo "EQUILIBRIUM_EXIT=$?"
timeout {max(60, cap_minutes - 90) * 60} {xvfb} node scripts/research/quant3d-paper-rows.mjs $OUT/rows 5199 --run $(cat /home/ubuntu/q3d-arms 2>/dev/null)
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


def fp64_script(cap_minutes, args):
    # Arms stop 45 min before the hard cap so the archive (with a restart dump of an unfinished
    # arm) can be written and pulled; the same commands resume it in a later session.
    py = "python -I scripts/research/quant3d-fp64-port.py"
    setup_env = r"""source /home/ubuntu/venv-fp64/bin/activate
CP=$(ls -d /usr/local/cuda-12* 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$CP" ] && ls "$CP"/lib64/libnvrtc.so.12* >/dev/null 2>&1; then
  export CUDA_PATH="$CP"; export LD_LIBRARY_PATH="$CP/lib64:${LD_LIBRARY_PATH:-}"
else
  NV=$(python -c "import nvidia.cuda_nvrtc as m; print(list(m.__path__)[0])")
  export LD_LIBRARY_PATH="$NV/lib:${LD_LIBRARY_PATH:-}"
fi"""
    arms = " ".join(FP64_ARMS)
    return f"""
set -euo pipefail
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
free -g | head -2
ls -d /usr/local/cuda* 2>/dev/null || true
cd /home/ubuntu
rm -rf solidify && git clone -q -b {BRANCH} /tmp/q3d.bundle solidify
cd solidify && git log --oneline -1
echo "{CAPTURE_SHA256}  /tmp/capture-states.tar.gz" | sha256sum -c -
mkdir -p verify-out/fp64-port && tar -xzf /tmp/capture-states.tar.gz -C verify-out/fp64-port
python3 -m venv /home/ubuntu/venv-fp64 || {{ sudo apt-get update -qq && sudo apt-get install -y -qq python3.10-venv && python3 -m venv /home/ubuntu/venv-fp64; }}
source /home/ubuntu/venv-fp64/bin/activate
pip install -q --upgrade pip
pip install -q "numpy==2.2.6" "scipy==1.15.3" "cupy-cuda12x==13.6.0"
if ! ls /usr/local/cuda-12*/lib64/libnvrtc.so.12* >/dev/null 2>&1; then pip install -q "nvidia-cuda-nvrtc-cu12==12.9.86"; fi
{setup_env}
echo "CUDA_PATH=${{CUDA_PATH:-unset}}"
python -c "import cupy as c; p=c.cuda.runtime.getDeviceProperties(0); print('CUPY', c.__version__, p['name'].decode(), c.cuda.runtime.runtimeGetVersion(), c.cuda.nvrtc.getVersion())"
mkdir -p /home/ubuntu/fp64-out
{py} --self-test 2>&1 | tee /home/ubuntu/fp64-out/self-test.log
{py} --box-gates --capture verify-out/fp64-port/capture 2>&1 | tee /home/ubuntu/fp64-out/box-gates.log
grep -q "^BOX-GATES PASS" /home/ubuntu/fp64-out/box-gates.log
echo BOX_GATES_PASS
cat > /home/ubuntu/run_fp64.sh << 'RUNEOF'
#!/bin/bash
set -uo pipefail
{setup_env}
cd /home/ubuntu/solidify
O=/home/ubuntu/fp64-out; A=scripts/research/quant3d-fp64-port-arms.json
END=$(( $(date -d "$(uptime -s)" +%s) + {cap_minutes} * 60 - 45 * 60 ))
echo "FP64_DEADLINE_EPOCH $END ($(date -d @$END))"
UNFINISHED=""
for arm in {arms}; do
  DONE=0
  for try in 1 2 3; do
    LEFT=$(( END - $(date +%s) ))
    [ $LEFT -gt 120 ] || break
    echo "FP64_ARM_START $arm try=$try left_s=$LEFT"
    timeout $LEFT {py} --config $A --arm $arm --out $O/$arm --dtype float64 --backend fused --resume auto \\
        --flush-minutes 20 --dump-every 61 >> $O/$arm.log 2>&1
    RC=$?
    echo "FP64_ARM_EXIT $arm rc=$RC"
    if [ $RC -eq 0 ]; then DONE=1; break; fi
  done
  if [ $DONE -eq 1 ]; then
    tar -czf /home/ubuntu/fp64-$arm.tar.gz --exclude='*.npy' -C $O $arm $arm.log
    echo "FP64_ARM_DONE $arm"
  else
    UNFINISHED="$UNFINISHED $arm"
    echo "FP64_ARM_UNFINISHED $arm"
  fi
done
python -I scripts/research/quant3d-q3c-tip-replay.py --campaign anchor=$O/w40-anchor/samples \\
    --campaign w28=$O/w28/samples --out $O/replay-fp64.json > $O/replay.log 2>&1
echo "REPLAY_EXIT=$?"
tar -czf /home/ubuntu/fp64-out.tar.gz --exclude='*.npy' -C /home/ubuntu fp64-out
RESUME=0
for arm in $UNFINISHED; do
  [ -f $O/$arm/port-run.json ] || continue
  STEM=""
  for PHI in $(ls $O/$arm/fields/$arm-*-phi.npy 2>/dev/null | sort -r); do
    S=${{PHI%-phi.npy}}; if [ -f $S-T.npy ]; then STEM=$S; break; fi
  done
  [ -n "$STEM" ] || continue
  tar -cf /home/ubuntu/fp64-resume.tar -C /home/ubuntu fp64-out/$arm/port-run.json fp64-out/$arm/samples \\
      ${{STEM#/home/ubuntu/}}-phi.npy ${{STEM#/home/ubuntu/}}-T.npy
  RESUME=1
done
echo "FP64_WRAPPER_DONE unfinished=[$UNFINISHED] resume_tar=$RESUME"
for i in $(seq 1 180); do [ -f /home/ubuntu/PULLED ] && exit 0; sleep 60; done
sudo shutdown -h now
RUNEOF
chmod +x /home/ubuntu/run_fp64.sh
nohup setsid /home/ubuntu/run_fp64.sh </dev/null >/home/ubuntu/fp64-out/run.log 2>&1 &
echo DETACHED_LAUNCH_OK
"""


def monitor(ip, args, run_dir):
    """Follow the remote run.log; pull per-arm results as they land and the archive at the end."""
    tag = args.tag
    remote_log = "/home/ubuntu/q3d-out/run.log" if args.mode == "rows" else "/home/ubuntu/fp64-out/run.log"
    progress_cmd = "grep -h '^PORT-PROGRESS' /home/ubuntu/fp64-out/*.log 2>/dev/null | tail -1"
    seen, pulled, fails, last_progress, last_progress_t = 0, set(), 0, "", 0.0
    while True:
        for _ in range(12):  # 2 min, checking the stop-file every 10 s
            if (run_dir / "STOP").exists():
                log("STOP file found; leaving the monitor (teardown follows)")
                return False
            time.sleep(10)
        try:
            rc, out, err = ssh_quick(ip, f"cat {remote_log} 2>/dev/null || true")
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
            if args.mode == "rows" and ln.startswith("ARM_DONE "):
                name = ln.split()[1]
                if name not in pulled:
                    a = scp_pull(ip, "/home/ubuntu/q3d-out/rows/paper-rows-result.json", LOCAL_VAL / f"quant3d-q3d-rows-{tag}.json")
                    b = scp_pull(ip, f"/home/ubuntu/q3d-out/rows/arms/{name}-samples.tar.gz", run_dir / f"{name}-samples.tar.gz")
                    log(f"PULLED arm={name} json={a} tar={b}")
                    pulled.add(name)
            if args.mode == "fp64" and ln.startswith("FP64_ARM_DONE "):
                name = ln.split()[1]
                if name not in pulled:
                    a = scp_pull(ip, f"/home/ubuntu/fp64-{name}.tar.gz", run_dir / f"fp64-{name}.tar.gz")
                    log(f"PULLED fp64 arm={name} tar={a}")
                    pulled.add(name)
        seen = len(lines)
        if args.mode == "fp64" and time.time() - last_progress_t > 600:
            try:
                _, prog, _ = ssh_quick(ip, progress_cmd)
                if prog.strip() and prog.strip() != last_progress:
                    log(f"[REMOTE] {prog.strip()[:400]}")
                    last_progress = prog.strip()
                last_progress_t = time.time()
            except Exception:
                pass
        if args.mode == "rows" and any(ln.startswith("Q3D_WRAPPER_DONE") for ln in lines):
            scp_pull(ip, "/home/ubuntu/q3d-out/rows/paper-rows-result.json", LOCAL_VAL / f"quant3d-q3d-rows-{tag}.json")
            scp_pull(ip, "/home/ubuntu/q3d-out/equilibrium/calibration-result.json", LOCAL_VAL / f"quant3d-q3d-equilibrium-{tag}.json")
            scp_pull(ip, "/home/ubuntu/q3d-out/replay.json", LOCAL_VAL / f"quant3d-q3d-rows-replay-{tag}.json")
            ok = scp_pull(ip, "/home/ubuntu/q3d-out.tar.gz", run_dir / "q3d-out.tar.gz")
        elif args.mode == "fp64" and any(ln.startswith("FP64_WRAPPER_DONE") for ln in lines):
            scp_pull(ip, "/home/ubuntu/fp64-out/replay-fp64.json", LOCAL_VAL / f"quant3d-q3d-fp64-replay-{tag}.json")
            ok = scp_pull(ip, "/home/ubuntu/fp64-out.tar.gz", run_dir / "fp64-out.tar.gz")
            if any("resume_tar=1" in ln for ln in lines):
                ok = scp_pull(ip, "/home/ubuntu/fp64-resume.tar", run_dir / "fp64-resume.tar") and ok
                log(f"PULLED resume tar ok={ok}")
        else:
            continue
        if ok:
            ssh_quick(ip, "touch /home/ubuntu/PULLED")
        log(f"FINAL_PULL archive={ok}")
        return ok


def main():
    # Remote apt/npm output contains non-cp1252 characters (e.g. U+2192); a redirected
    # Windows stdout would raise UnicodeEncodeError mid-provisioning (first launch, 11-26).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--mode", choices=["rows", "fp64"], required=True)
    ap.add_argument("--tag", required=True, help="names the run directory and the pulled result files")
    ap.add_argument("--arms", default="", help="rows: comma list passed to --arms (empty = every registered arm)")
    ap.add_argument("--fallback-arms", default="", help="rows: arms to run if the VRAM smoke of the largest fails")
    ap.add_argument("--matrix", default="scripts/research/quant3d-equilibrium-matrix-q3d.json")
    ap.add_argument("--instances", default="g6e.xlarge,g6e.2xlarge,g6e.4xlarge")
    ap.add_argument("--cap-usd", type=float, default=35.0)
    args = ap.parse_args()
    global STATE_FILE
    run_dir = pathlib.Path(rf"D:\solidify\q3d-{args.mode}-{args.tag}")
    STATE_FILE = run_dir / f"aws_q3d_{args.mode}_state.json"
    instances = [(t, RATES[t]) for t in args.instances.split(",")]
    head = subprocess.run(["git", "-C", str(WORKTREE), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    # The box clones the committed branch (bundle), so only campaign files need to match HEAD.
    campaign = ["src", "scripts/fixtures", "scripts/browser-cleanup.mjs", "scripts/research/quant3d-paper-rows.mjs",
                "scripts/research/quant3d-paper-rows-model.mjs", "scripts/research/quant3d-paper-rows.md",
                "scripts/research/quant3d-width-ladder-model.mjs", "scripts/research/quant3d-equilibrium.mjs",
                "scripts/research/quant3d-equilibrium-driver.mjs", args.matrix,
                "scripts/research/quant3d-q3c-tip-replay.py", "scripts/research/aws_q3d_launch.py", "package.json", "package-lock.json",
                "scripts/research/quant3d-fp64-port.py", "scripts/research/quant3d-fp64-port-selftest.py",
                "scripts/research/quant3d-fp64-port-arms.json", "scripts/research/quant3d-fp64-port.md"]
    dirty = subprocess.run(["git", "-C", str(WORKTREE), "status", "--porcelain", "--", *campaign],
                           capture_output=True, text=True, check=True).stdout.strip()
    if dirty:
        raise SystemExit(f"worktree has uncommitted or untracked campaign changes; freeze first:\n{dirty}")
    if args.mode == "fp64":
        import hashlib
        if hashlib.sha256(CAPTURE.read_bytes()).hexdigest() != CAPTURE_SHA256:
            raise SystemExit(f"capture bundle {CAPTURE} missing or changed")
    if args.dry_run:
        print((rows_script if args.mode == "rows" else fp64_script)(18 * 60, args))
        return
    run_dir.mkdir(parents=True, exist_ok=True)
    if STATE_FILE.exists() and not json.loads(STATE_FILE.read_text(encoding="utf-8")).get("torn_down", True):
        raise SystemExit(f"{STATE_FILE} records a launch that was not torn down; refusing a second one")
    bundle = run_dir / "q3d.bundle"
    subprocess.run(["git", "-C", str(WORKTREE), "bundle", "create", str(bundle), BRANCH], check=True, capture_output=True)
    ident = aws("sts", "get-caller-identity")
    log(f"AWS_OK {ident['Arn']}  mode={args.mode} frozen={head}")
    keep_awake(True)
    my_ip = urllib.request.urlopen("https://checkip.amazonaws.com", timeout=15).read().decode().strip()
    ts = time.strftime("%Y%m%d-%H%M%S")
    name = f"solidify-q3d-{args.mode}-{ts}"
    state = {"frozen": head, "mode": args.mode, "key_name": name, "started": ts, "torn_down": False}
    save(state)
    imgs = aws("ec2", "describe-images", "--owners", "amazon", "--filters",
               "Name=name,Values=Deep Learning OSS Nvidia Driver AMI GPU PyTorch 2.* (Ubuntu 22.04)*",
               "Name=state,Values=available", "Name=architecture,Values=x86_64")["Images"]
    ami = sorted(imgs, key=lambda x: x["CreationDate"], reverse=True)[0]["ImageId"]
    state["ami"] = ami
    try:
        aws("ec2", "import-key-pair", "--key-name", state["key_name"], "--public-key-material", f"fileb://{PUB_KEY}")
        state["sg_id"] = aws("ec2", "create-security-group", "--group-name", name,
                             "--description", f"Temp SSH for SOLIDIFY Q3d ({args.mode})", "--vpc-id", VPC_ID)["GroupId"]
        aws("ec2", "authorize-security-group-ingress", "--group-id", state["sg_id"], "--protocol", "tcp",
            "--port", "22", "--cidr", f"{my_ip}/32", parse_json=False)
        save(state)
        subnets = aws("ec2", "describe-subnets", "--filters", f"Name=vpc-id,Values={VPC_ID}")["Subnets"]
        subnets.sort(key=lambda s: (0 if s["AvailabilityZone"].endswith("a") else 1, s["AvailabilityZone"]))
        bdm = json.dumps([{"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 120, "VolumeType": "gp3", "DeleteOnTermination": True}}])
        for itype, rate in instances:
            cap_minutes = min(18 * 60, int(math.floor(args.cap_usd / rate * 60)))
            tags = json.dumps([{"ResourceType": "instance", "Tags": [{"Key": "Name", "Value": name},
                              {"Key": "Owner", "Value": "frank"}, {"Key": "Purpose", "Value": f"SOLIDIFY-Q3d-{args.mode}"}]}])
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
        if args.mode == "fp64":
            subprocess.run(["scp", *SSH_OPTS, str(CAPTURE), f"ubuntu@{ip}:/tmp/capture-states.tar.gz"], check=True)
        try:
            ssh_stream(ip, (rows_script if args.mode == "rows" else fp64_script)(state["cap_minutes"], args))
        except Exception:
            # Keep the evidence before teardown deletes the box.
            if args.mode == "rows":
                scp_pull(ip, "/home/ubuntu/q3d-out/preflight/preflight-result.json", run_dir / f"preflight-failed-{ts}.json")
                scp_pull(ip, "/tmp/vite.log", run_dir / f"vite-failed-{ts}.log")
            else:
                scp_pull(ip, "/home/ubuntu/fp64-out/box-gates.log", run_dir / f"box-gates-failed-{ts}.log")
                scp_pull(ip, "/home/ubuntu/fp64-out/self-test.log", run_dir / f"self-test-failed-{ts}.log")
            raise
        log("GATES PASSED, detached run launched; monitoring")
        monitor(ip, args, run_dir)
    finally:
        teardown(state)
        keep_awake(False)


if __name__ == "__main__":
    main()
