from fastapi import APIRouter

from app.api.v1 import app_info, audit, auth, budgets, health, occurrences, recurring_payments, summary, tickets, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(recurring_payments.router)
api_router.include_router(occurrences.router)
api_router.include_router(summary.router)
api_router.include_router(users.router)
api_router.include_router(budgets.router)
api_router.include_router(tickets.router)
api_router.include_router(audit.router)
api_router.include_router(app_info.router)
api_router.include_router(health.router)
