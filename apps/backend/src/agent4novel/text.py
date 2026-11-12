def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def utf16_slice(text: str, start: int, end: int | None = None) -> str:
    encoded = text.encode("utf-16-le", errors="surrogatepass")
    return encoded[start * 2 : end * 2 if end is not None else None].decode(
        "utf-16-le", errors="surrogatepass"
    )
