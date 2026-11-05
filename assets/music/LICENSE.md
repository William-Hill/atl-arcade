# Music licenses (assets/music)

Checked 2026-11-05, before any track was made.

## The tool: ACE-Step 1.5

| Part | Version | License | Source |
|---|---|---|---|
| Code | `ace-step/ACE-Step-1.5`, commit `ca1e85fe9430179831e6bc6be790c332190a3866` (2026-08-29), package `ace-step` 1.5.0 | MIT | [LICENSE](https://github.com/ace-step/ACE-Step-1.5/blob/main/LICENSE) (copy in `ACE-STEP-LICENSE.txt`), README "License & Disclaimer" |
| Model weights | `ACE-Step/Ace-Step1.5` on Hugging Face, revision `19671f406d603126926c1b7e2adc169acbcade22`: `acestep-v15-turbo` (DiT), `vae`, `Qwen3-Embedding-0.6B` (text encoder). The 5 Hz LM was downloaded (`acestep-5Hz-lm-0.6B`, MIT) but not used. | MIT | [model card](https://huggingface.co/ACE-Step/Ace-Step1.5) (`license: mit`) |

## The output

- The model card says: "Commercial-Ready: ... You can strictly use the generated music for commercial purposes." It says the training data is licensed music, royalty-free / public domain music, and synthetic MIDI-to-audio data.
- The MIT license places no terms on what the model generates. A free public game is a narrower use than the commercial use the card allows.
- The README disclaimer asks users to check that the work is original, to say that AI made it, and not to copy protected styles. We follow it:
  - The prompts are genre and instrument words only. No artist, song, label, or producer names. No lyrics: every track is `[Instrumental]`.
  - No reference audio, no cover or repaint of an existing song, no samples. Each track is text-to-music from a seed.
  - `provenance.json`, this file and `docs/decisions.md` say that the music was made with ACE-Step 1.5 (AI). The game has no credits screen yet; when it gets one, it should say so too.
- In the US, purely AI-generated music may not be protected by copyright, so others could reuse these tracks. That is fine for a free game.

## The tracks

The four tracks in `tracks.json` (`*.ogg`, and the `*.m4a` fallbacks) are original works made for this repository with ACE-Step 1.5. They may be used in Skate ATL and its promotion. `provenance.json` records the prompt, the seed, the settings, the render time, and the measured tempo of each one.

Decision on #20 ("written licenses and local or original tracks"): these are original tracks with written licenses. Tracks by Atlanta artists can replace or join them later (#20); `tracks.json` takes more entries.
