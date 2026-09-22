"""Operation-local caches shared by hooks and state commands."""

from contextlib import contextmanager
from contextvars import ContextVar


_operation = ContextVar("evidence_operation", default=None)


@contextmanager
def evidence_operation():
    if _operation.get() is not None:
        yield
        return
    token = _operation.set({})
    try:
        yield
    finally:
        _operation.reset(token)


def memo(key, compute):
    cache = _operation.get()
    if cache is None:
        return compute()
    if key not in cache:
        cache[key] = compute()
    return cache[key]


def invalidate_memo(key):
    cache = _operation.get()
    if cache is not None:
        cache.pop(key, None)


def cached_memo(key):
    cache = _operation.get()
    return cache.get(key) if cache is not None else None
