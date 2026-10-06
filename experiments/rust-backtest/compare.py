"""Compare normalized replay output, with exact execution values and bounded derived floats."""
import json
import math
import sys

EXACT_SUFFIXES = ('.price', '.size', '.tsMs', '.nowMs', '.filled', '.remaining', '.qty')


def compare(a, b, path='$'):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        exact = isinstance(a, int) and isinstance(b, int) or path.endswith(EXACT_SUFFIXES)
        if a != b and (exact or not math.isclose(a, b, rel_tol=0, abs_tol=1e-10)):
            raise AssertionError(f'{path}: {a!r} != {b!r}')
    elif isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            raise AssertionError(f'{path}: keys {a.keys()} != {b.keys()}')
        for key in a:
            compare(a[key], b[key], f'{path}.{key}')
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            raise AssertionError(f'{path}: lengths {len(a)} != {len(b)}')
        for i, (left, right) in enumerate(zip(a, b)):
            compare(left, right, f'{path}[{i}]')
    elif a != b:
        raise AssertionError(f'{path}: {a!r} != {b!r}')


def normalized(document):
    return [{key: value for key, value in result.items() if key != 'durationMs'}
            for result in document['results']]


if __name__ == '__main__':
    left = json.load(open(sys.argv[1]))
    right = json.load(open(sys.argv[2]))
    compare(normalized(left), normalized(right))
    print('Parity passed:', len(left['results']), 'markets')
