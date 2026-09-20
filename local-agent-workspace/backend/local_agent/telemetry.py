"""Provider-reported chat usage and failure categories, without estimates."""


class InferenceError(ValueError):
    def __init__(self, message, kind="unknown", http_status=None):
        super().__init__(message)
        self.kind = kind
        self.http_status = http_status


def http_error_kind(status):
    if status == 401:
        return "authentication"
    if status == 403:
        return "permission"
    if status == 429:
        return "rate_limit"
    if 400 <= status < 500:
        return "invalid_request"
    if status >= 500:
        return "server"
    return "unknown"


def stream_error_kind(error):
    if not isinstance(error, dict):
        return "unknown"
    for key in ("status", "status_code", "code"):
        status = error.get(key)
        if type(status) is int and 400 <= status <= 599:
            return http_error_kind(status)
    codes = {
        "authentication_error": "authentication", "unauthenticated": "authentication",
        "permission_error": "permission", "permission_denied": "permission",
        "rate_limit_error": "rate_limit", "resource_exhausted": "rate_limit",
        "too_many_requests": "rate_limit", "invalid_request_error": "invalid_request",
        "invalid_parameter_value": "invalid_request", "bad_request": "invalid_request",
        "api_error": "server", "server_error": "server", "internal_error": "server",
        "overloaded_error": "server",
    }
    for key in ("type", "code", "error_code"):
        value = error.get(key)
        if isinstance(value, str) and value.lower() in codes:
            return codes[value.lower()]
    return "unknown"


def reported_usage(value):
    if not isinstance(value, dict):
        return {}
    aliases = {
        "input_tokens": ("prompt_tokens", "input_tokens"),
        "output_tokens": ("completion_tokens", "output_tokens"),
        "total_tokens": ("total_tokens",),
        "cache_read_input_tokens": ("cache_read_input_tokens",),
        "cache_creation_input_tokens": ("cache_creation_input_tokens",),
        "reasoning_tokens": ("reasoning_tokens",),
    }
    usage = {}
    for name, keys in aliases.items():
        for key in keys:
            count = value.get(key)
            if type(count) is int and count >= 0:
                usage[name] = count
                break
    for field, key, name in (("prompt_tokens_details", "cached_tokens", "cache_read_input_tokens"),
                             ("completion_tokens_details", "reasoning_tokens", "reasoning_tokens")):
        details = value.get(field)
        count = details.get(key) if isinstance(details, dict) else None
        if name not in usage and type(count) is int and count >= 0:
            usage[name] = count
    return usage
