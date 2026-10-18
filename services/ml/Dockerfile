FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .
RUN adduser --disabled-password --gecos "" --uid 10001 appuser
USER appuser
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --no-access-log"]
