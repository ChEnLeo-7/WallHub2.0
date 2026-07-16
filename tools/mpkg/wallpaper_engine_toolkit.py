#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compatibility wrapper for the pure local mobile MPKG converter."""

from __future__ import annotations

import sys
from typing import List

import mobile_mpkg


def _translate_legacy_args(argv: List[str]) -> List[str]:
    if not argv:
        return argv

    command = argv[0]
    if command == 'convert-workshop':
        return ['convert-workshop', *argv[1:]]

    if command == 'extract':
        translated = ['extract']
        for arg in argv[1:]:
            if arg in ('--pkg', '--long-string-support', '--no-tex-convert'):
                continue
            translated.append(arg)
        return translated

    if command == 'info':
        return argv

    legacy_commands = {'pack', 'convert', 'convert-format'}
    if command in legacy_commands:
        print(
            f"Error: '{command}' was part of the legacy all-in-one toolkit and "
            "is no longer available in the pure local converter.",
            file=sys.stderr,
        )
        print("Use legacy/wallpaper_engine_toolkit_legacy.py if you still need that old command.", file=sys.stderr)
        raise SystemExit(2)

    return argv


def main() -> int:
    return mobile_mpkg.main_with_args(_translate_legacy_args(sys.argv[1:]))


if __name__ == '__main__':
    raise SystemExit(main())
