"""Hash helpers shared by full parity/benchmark runs."""
import hashlib
from pathlib import Path
from benchmark import HERE

def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def raw_fingerprint(manifest):
    for file in manifest['rawInputFiles']:
        if sha(file['path'])!=file['sha256']:raise RuntimeError(f'Original feed changed: {file["path"]}')

def source_fingerprint():
    root=HERE.parent.parent
    paths=sorted(list((root/'src').rglob('*.ts'))+list((HERE/'src').glob('*.rs'))+list(HERE.glob('*.mts'))+list(HERE.glob('*.py'))+[HERE/'Cargo.toml',HERE/'Cargo.lock',root/'package.json',root/'package-lock.json'])
    return {str(p.relative_to(root)):sha(p) for p in paths}
