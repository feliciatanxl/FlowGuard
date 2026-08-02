import argparse
from dataset_prep import prepare_dataset
from train import train_model
from export_onnx import export_to_onnx
from compile_imx500 import compile_rpk

def main():
    parser = argparse.ArgumentParser(description="SecurePi End-to-End AI Model Pipeline")
    parser.add_argument("--skip-dataset", action="store_true", help="Skip dataset downloading & formatting")
    parser.add_argument("--skip-train", action="store_true", help="Skip model training")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--imgsz", type=int, default=320, help="Image resolution")
    args = parser.parse_args()

    print("🚀 Starting SecurePi AI Model Building Pipeline...")

    # Step 1: Prepare Dataset
    if not args.skip_dataset:
        print("\n=== STEP 1: PREPARING DATASET ===")
        prepare_dataset()

    # Step 2: Train Model
    if not args.skip_train:
        print("\n=== STEP 2: TRAINING MODEL ===")
        train_model(epochs=args.epochs, imgsz=args.imgsz)

    # Step 3: Export ONNX
    print("\n=== STEP 3: EXPORTING ONNX MODEL ===")
    onnx_file = export_to_onnx(imgsz=args.imgsz)

    # Step 4: Compile RPK
    print("\n=== STEP 4: COMPILING TO IMX500 (.rpk) ===")
    compile_rpk(onnx_path=onnx_file, imgsz=args.imgsz)

    print("\n🎉 Pipeline complete! Generated model file: imx500_custom_securepi.rpk")

if __name__ == "__main__":
    main()
