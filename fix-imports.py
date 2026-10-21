#!/usr/bin/env python3
"""
Add .js extensions to relative imports in dist/server/ for Node.js ESM compatibility.

Fixes: import x from './foo'  ->  import x from './foo.js'
       import x from '../bar'  ->  import x from '../bar.js'
Skips: imports with full paths, @ aliases, already .js, or node_modules.
"""
import re
import sys
from pathlib import Path

ROOT = Path("/home/xionghao/work/openCode/mattpocock/quant-trading/dist/server")

# Match: from './...' or from '../...' (no extension)
# Capture: from 'PATH'
PATTERN = re.compile(r"""(from\s+['"])(\.\.?/[^'"]+?)(?<!\.js)(?<!\.json)(?<!\.node)(['"])""")

count = 0
files_changed = 0
for js_file in ROOT.rglob("*.js"):
    text = js_file.read_text()
    new_text, n = PATTERN.subn(r"\1\2.js\3", text)
    if n > 0:
        js_file.write_text(new_text)
        files_changed += 1
        count += n

print(f"Fixed {count} imports in {files_changed} files")
