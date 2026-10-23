from fastapi import APIRouter

from app.api.v1 import auth, health, occurrences, recurring_payments, summary, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(recurring_payments.router)
api_router.include_router(occurrences.router)
api_router.include_router(summary.router)
api_router.include_router(users.router)
api_router.include_router(health.router)
