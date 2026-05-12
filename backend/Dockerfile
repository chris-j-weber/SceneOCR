FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# USE_GPU=true  → install onnxruntime-gpu + NVIDIA CUDA/cuDNN pip libs (no base-image change needed)
# USE_GPU=false → install onnxruntime (CPU only, works everywhere)
ARG USE_GPU=false

RUN pip install --no-cache-dir rapidocr-onnxruntime \
 && pip uninstall -y onnxruntime || true \
 && if [ "$USE_GPU" = "true" ]; then \
        echo "[build] Installing onnxruntime-gpu + CUDA libs" \
        && pip install --no-cache-dir \
            onnxruntime-gpu \
            nvidia-cublas-cu12 \
            nvidia-cudnn-cu12 \
            nvidia-cuda-runtime-cu12 \
            nvidia-cufft-cu12 \
            nvidia-curand-cu12; \
    else \
        echo "[build] Installing onnxruntime (CPU)" \
        && pip install --no-cache-dir onnxruntime; \
    fi

# Let onnxruntime-gpu find the CUDA shared libs installed by the nvidia-* packages above.
# These paths are harmless no-ops in CPU builds (non-existent dirs are silently skipped).
ENV LD_LIBRARY_PATH="/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:\
/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib:\
/usr/local/lib/python3.11/site-packages/nvidia/cuda_runtime/lib:\
/usr/local/lib/python3.11/site-packages/nvidia/cufft/lib:\
/usr/local/lib/python3.11/site-packages/nvidia/curand/lib"

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/uploads /app/jobs

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
