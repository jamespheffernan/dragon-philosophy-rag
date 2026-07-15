from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    openai_api_key: str
    # Paths can be overridden with environment variables.
    vector_db_path: str = "./vectors.db"
    upload_dir: str = "./uploads"
    metadata_db_path: str = "./documents.db"
    # CORS allowed origins, as a comma-separated list.
    cors_origins: str = "http://localhost:3000"

    def get_cors_origins(self) -> List[str]:
        """Parse configured CORS origins without adding deployment-specific hosts."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
