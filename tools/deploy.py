import os
import re
import sys
from datetime import datetime
import subprocess

# 1. Generate version from current timestamp
now = datetime.now()
new_version = now.strftime("%Y.%m.%d.%H%M")
print(f"Bumping app version to: {new_version}")

root_dir = os.path.join(os.path.dirname(__file__), '..')

def update_file(relative_path, pattern, replacement):
    filepath = os.path.join(root_dir, relative_path)
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        content = re.sub(pattern, replacement, content)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  Updated {relative_path}")
    except FileNotFoundError:
        print(f"  Could not find {relative_path}")

# 2. Bump version strings
update_file('index.html', r'\?v=[\d\.]+', f'?v={new_version}')
update_file('sw.js', r"const CACHE_NAME = 'movie-catalogue-v[^']+';", f"const CACHE_NAME = 'movie-catalogue-v{new_version}';")

# 3. Build commit message
commit_msg = f"Deploy v{new_version}"
if len(sys.argv) > 1:
    custom_msg = " ".join(sys.argv[1:])
    commit_msg = f"{custom_msg} (v{new_version})"

# 4. Git add, commit, push
print(f"Committing: '{commit_msg}'")
try:
    subprocess.run(["git", "add", "."], check=True, cwd=root_dir)
    subprocess.run(["git", "commit", "-m", commit_msg], check=True, cwd=root_dir)
    subprocess.run(["git", "push"], check=True, cwd=root_dir)
    print("Deployment complete! Refresh your phone to see the update.")
except Exception as e:
    print(f"Git push failed: {e}")
