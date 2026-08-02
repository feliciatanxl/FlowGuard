import argparse
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def get_latest_onnx(base_dir: str = "runs/detect") -> str:
    """
    Finds the latest exported best.onnx model in runs/detect/ (e.g., securepi_model, securepi__model-2, etc.).
    """
    detect_path = Path(base_dir)
    if detect_path.exists():
        matching_dirs = [
            d for d in detect_path.iterdir()
            if d.is_dir() and (d / "weights" / "best.onnx").exists()
        ]
        if matching_dirs:
            latest_dir = sorted(matching_dirs, key=lambda d: (d / "weights" / "best.onnx").stat().st_mtime, reverse=True)[0]
            best_onnx = latest_dir / "weights" / "best.onnx"
            print(f"💡 Found latest ONNX model at: {best_onnx}")
            return str(best_onnx)

    return "runs/detect/securepi_model/weights/best.onnx"

def compile_rpk(
    onnx_path: str = None,
    output_rpk: str = "imx500_custom_securepi.rpk",
    quantization_ds: str = "./dataset/images/val",
    imgsz: int = 320
):
    """
    Compiles ONNX model to Sony IMX500 hardware format (.rpk).
    """
    if onnx_path is None or onnx_path == "":
        onnx_path = get_latest_onnx()

    onnx_file = Path(onnx_path)
    if not onnx_file.exists():
        raise FileNotFoundError(f"ONNX model file not found at '{onnx_path}'. Export model first using export_onnx.py!")

    import shutil

    def find_converter_bin():
        # Check active Python environment scripts folder (e.g. venv311/Scripts)
        env_dir = Path(sys.executable).parent
        for bin_name in ["sdspconv.exe", "imxconv-pt.exe", "imx500-converter.exe", "sdspconv", "imxconv-pt"]:
            target = env_dir / bin_name
            if target.exists():
                return str(target)

        # Check local venv311 directory in workspace
        workspace_venv = Path("./venv311/Scripts")
        for bin_name in ["sdspconv.exe", "imxconv-pt.exe", "imx500-converter.exe"]:
            target = workspace_venv / bin_name
            if target.exists():
                return str(target)

        # Check system PATH
        for bin_name in ["sdspconv", "imxconv-pt", "imx500-converter"]:
            found = shutil.which(bin_name)
            if found:
                return found

        return "sdspconv"

    converter_bin = find_converter_bin()

    cmd = [
        converter_bin, "convert",
        "--input", str(onnx_file),
        "--output", output_rpk,
        "--input-shape", "1", "3", str(imgsz), str(imgsz),
        "--quantization-dataset", quantization_ds,
        "--target-device", "imx500"
    ]

    print(f"⚙️ Compiling ONNX model to Sony IMX500 RPK format...")
    print(f"Running command: {' '.join(cmd)}")

    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0:
            print(f"❌ Compilation failed with exit code {res.returncode}")
            print(f"Error output:\n{res.stderr}")
            sys.exit(res.returncode)

        print(f"🎉 Model compiled successfully! File saved to: {output_rpk}")
    except FileNotFoundError:
        print("\n⚠️ 'imx500-converter' tool not found on your system!")
        print("💡 Note: Sony's 'imx500-converter' tool requires Python 3.8 - 3.11 (not Python 3.12+).")
        print("👉 Recommended Options:")
        print("   1. Run training & compilation on Google Colab using SecurePi.ipynb (T4 GPU & Python 3.10).")
        print("   2. Or create a Python 3.10 virtual environment locally: 'conda create -n securepi python=3.10' & 'pip install imx500-converter'.")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compile ONNX model to Raspberry Pi AI Camera (.rpk) format")
    parser.add_argument("--input-onnx", type=str, default="", help="Path to .onnx file (leave empty to auto-detect latest)")
    parser.add_argument("--output-rpk", type=str, default="imx500_custom_securepi.rpk", help="Output .rpk filename")
    parser.add_argument("--val-dataset", type=str, default="./dataset/images/val", help="Quantization dataset path")
    parser.add_argument("--imgsz", type=int, default=320, help="Input resolution")
    args = parser.parse_args()

    compile_rpk(onnx_path=args.input_onnx, output_rpk=args.output_rpk, quantization_ds=args.val_dataset, imgsz=args.imgsz)
