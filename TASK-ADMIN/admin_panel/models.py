from dataclasses import dataclass


@dataclass
class User:
    id: int
    email: str
    full_name: str
    role: str
    status: str
    password_hash: str
    created_at: str


@dataclass
class LicenseAssignment:
    id: int
    user_id: int
    product: str
    assigned_at: str
    expires_at: str | None
    status: str


@dataclass
class AuditLogEntry:
    id: int
    action: str
    target_email: str
    performed_by: str
    details: str
    timestamp: str
