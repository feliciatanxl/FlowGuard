# models/

Place the **compiled model** and its **labels file** here. These are the only
two files the Raspberry Pi edge runtime (`edge/securePi.py`) needs at inference
time.

```
models/
├── imx500_custom_securepi.rpk   # compiled IMX500 network — NOT committed (see below)
├── labels.txt                   # class names in output-index order (committed)
└── README.md                    # this file
```

## What is committed vs. what you provide

| File | Committed? | How you get it |
|------|-----------|----------------|
| `labels.txt` | ✅ yes | Shipped in the repo (class index order below). |
| `imx500_custom_securepi.rpk` | ❌ **no** — git-ignored (`*.rpk`) | Generated **off-device** by the training pipeline, then copied here manually. |

`.rpk`, `.pt`, and `.onnx` files are intentionally excluded from Git (see the
root `.gitignore`). Model artefacts are large and are produced separately — the
repository never stores them and never fabricates a placeholder.

## `labels.txt` — order matters

`edge/securePi.py` maps each detection's numeric class index to a label **by
line position** in this file, then routes it by name (person / unattended
object / pest). The order MUST match the training class ids
(`training/dataset_prep.py` → `dataset.yaml`):

```
0  person
1  backpack
2  handbag
3  suitcase
4  rat
5  mouse
```

If you retrain with a different class order, regenerate `labels.txt` to match,
or every label will be wrong.

## Deploying the compiled model

After compiling on a computer/Colab (see the root `README.md` → *Training
workflow*), copy both files onto the Pi and run:

```bash
python edge/securePi.py @edge/presets/lobby.args \
  --model models/imx500_custom_securepi.rpk \
  --labels models/labels.txt \
  --headless
```

## ⚠️ Parser-compatibility caveat (read before you rely on the custom model)

The custom model is exported from **YOLOv8**. A stock YOLOv8 export produces a
**single raw output tensor** (`[1, 4+num_classes, num_anchors]`) that requires
YOLO-specific decoding + NMS. The IMX500 detection parser in `edge/securePi.py`
currently decodes only:

1. the **SSD "_pp"** 3-tensor format (`boxes`, `scores`, `classes`), and
2. **NanoDet** (`postprocess_nanodet_detection`).

**It does not decode a raw YOLOv8 tensor.** Successfully producing an `.rpk`
does **not** guarantee the edge runtime can read it. See
[docs/MODELS.md](../docs/MODELS.md) → *Known model-parser limitation* for the
expected tensor formats, required metadata, and exactly what must be verified on
the physical Raspberry Pi. Until that verification passes, treat the custom
model as **unvalidated on hardware**.
