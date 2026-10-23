from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Служебное"])


class Health(BaseModel):
    status: str


@router.get("/health", response_model=Health, summary="Проверка работоспособности")
def health() -> Health:
    return Health(status="ok")
