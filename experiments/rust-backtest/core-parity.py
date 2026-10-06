"""Run portable full-output differential tests without any private market data."""
import argparse
import json
import subprocess
from pathlib import Path
from compare import compare

HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--node',required=True)
args=parser.parse_args()
subprocess.run(['python3',str(HERE/'core-fixtures.py')],check=True)
(HERE/'results').mkdir(exist_ok=True)
source=HERE/'fixtures/core-input.json'
left=HERE/'results/core-typescript.json';right=HERE/'results/core-rust.json'
subprocess.run([args.node,'--import','tsx',str(HERE/'core-oracle.mts'),str(source),str(left)],cwd=HERE.parent.parent,check=True)
subprocess.run([str(HERE/'target/release/rust-backtest-experiment'),'fixtures',str(source),str(right)],check=True)
expected=json.loads(left.read_text());actual=json.loads(right.read_text())
compare(expected,actual)
print(f'Full-output core parity passed: {len(expected["results"])} behavior cases, {len(expected["aggregations"])} batch/calendar cases, {len(expected["fixed"])} decimal cases')
