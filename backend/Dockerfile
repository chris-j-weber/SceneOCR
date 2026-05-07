FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# USE_GPU=true  → install onnxruntime-gpu (requires CUDA 12 + cuDNN 9 at runtime)
# USE_GPU=false → install onnxruntime   (CPU only, works everywhere)
ARG USE_GPU=false

RUN pip install --no-cache-dir rapidocr-onnxruntime \
 && pip uninstall -y onnxruntime || true \
 && if [ "$USE_GPU" = "true" ]; then \
        echo "[build] Installing onnxruntime-gpu" \
        && pip install --no-cache-dir onnxruntime-gpu; \
    else \
        echo "[build] Installing onnxruntime (CPU)" \
        && pip install --no-cache-dir onnxruntime; \
    fi

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/uploads /app/jobs

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
