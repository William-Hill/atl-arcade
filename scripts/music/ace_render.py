#!/usr/bin/env python3
"""Render one ACE-Step 1.5 take on this machine (CPU works, slowly).

Run with the ACE-Step venv:
  ~/tools/ACE-Step-1.5/.venv-cpu/bin/python scripts/music/ace_render.py \
      --spec scripts/music/tracks.spec.json --id day-trail --seed 1 --out /tmp/takes

Writes <out>/<id>-s<seed>.wav and <out>/<id>-s<seed>.json (settings, render time).
"""
import argparse
import json
import os
import shutil
import sys
import time

ACE_ROOT = os.environ.get("ACE_STEP_ROOT", os.path.expanduser("~/tools/ACE-Step-1.5"))
sys.path.insert(0, ACE_ROOT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, default=None)
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--thinking", action="store_true", help="use the 5 Hz LM planner (slower)")
    ap.add_argument("--lm", default="acestep-5Hz-lm-0.6B")
    args = ap.parse_args()

    spec = {t["id"]: t for t in json.load(open(args.spec))["tracks"]}[args.id]
    duration = args.duration or spec["renderSeconds"]
    steps = args.steps or spec.get("steps", 8)
    os.makedirs(args.out, exist_ok=True)

    import torch
    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    torch.set_num_threads(os.cpu_count() or 4)
    t0 = time.time()
    dit = AceStepHandler()
    msg, ok = dit.initialize_service(project_root=ACE_ROOT, config_path="acestep-v15-turbo", device="cpu")
    if not ok:
        sys.exit(f"DiT init failed: {msg}")
    llm = LLMHandler()
    if args.thinking:
        msg, ok = llm.initialize(checkpoint_dir=os.path.join(ACE_ROOT, "checkpoints"), lm_model_path=args.lm, backend="pt", device="cpu")
        if not ok:
            sys.exit(f"LM init failed: {msg}")
    load_s = time.time() - t0

    params = GenerationParams(
        task_type="text2music",
        thinking=args.thinking,
        caption=spec["caption"],
        lyrics="[Instrumental]",
        instrumental=True,
        bpm=spec["bpm"],
        keyscale=spec.get("keyscale", ""),
        timesignature="4",
        duration=duration,
        inference_steps=steps,
        seed=args.seed,
    )
    config = GenerationConfig(batch_size=1, audio_format="wav", use_random_seed=False, seeds=[args.seed])
    t1 = time.time()
    tmp = os.path.join(args.out, f"_{args.id}-s{args.seed}")
    result = generate_music(dit, llm, params=params, config=config, save_dir=tmp)
    render_s = time.time() - t1
    if not result.success:
        sys.exit(f"generation failed: {result.error or result.status_message}")
    src = result.audios[0]["path"]
    base = os.path.join(args.out, f"{args.id}-s{args.seed}")
    shutil.move(src, base + ".wav")
    shutil.rmtree(tmp, ignore_errors=True)
    meta = {
        "id": args.id,
        "seed": args.seed,
        "caption": spec["caption"],
        "lyrics": "[Instrumental]",
        "bpm": spec["bpm"],
        "keyscale": spec.get("keyscale", ""),
        "timesignature": "4",
        "duration": duration,
        "inferenceSteps": steps,
        "thinking": args.thinking,
        "lm": args.lm if args.thinking else None,
        "dit": "acestep-v15-turbo",
        "device": "cpu",
        "threads": torch.get_num_threads(),
        "loadSeconds": round(load_s, 1),
        "renderSeconds": round(render_s, 1),
    }
    json.dump(meta, open(base + ".json", "w"), indent=2)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
