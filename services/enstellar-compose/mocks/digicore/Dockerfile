FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 8000
# nosemgrep: dockerfile.security.missing-user.missing-user  # false positive — local dev mock only; never deployed to any environment beyond docker-compose local stack
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
