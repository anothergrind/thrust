# Recording for the README demo, driven by VHS (https://github.com/charmbracelet/vhs).
#
#   vhs demo/demo.tape        renders docs/demo.gif
#
# Nobody has to install VHS to refresh it: the "Demo" workflow renders this
# tape on GitHub Actions and uploads the GIF as an artifact.
#
# It records the CLI as it is run today, from a checkout. When the package is
# published, the typed line becomes `npm create thrust@latest`.

Output docs/demo.gif

Require node

Set Shell bash
Set FontSize 18
Set Width 1100
Set Height 700
Set Padding 30
Set TypingSpeed 55ms
Set Theme "Catppuccin Mocha"

# Setup that shouldn't appear in the recording: remember where the built CLI
# is, drop into an empty directory, and use a bare prompt.
Hide
Type `export CLI="$PWD/dist/index.js"` Enter
Type `cd "$(mktemp -d)"` Enter
Type `export PS1="$ "` Enter
Type `clear` Enter
Show

Sleep 1s
Type `node "$CLI"` Enter
Sleep 3s

# Project name
Type "my-app"
Sleep 800ms
Enter
Sleep 2s

# Backend stack: move down to Python (FastAPI) to show the picker working.
Down
Sleep 700ms
Enter
Sleep 1500ms

# Frontend: move down to SvelteKit, so the recording shows both choices.
Down
Sleep 700ms
Enter
Sleep 3s

# "Install dependencies now?" — No, so the recording stays short.
Right
Sleep 600ms
Enter
Sleep 5s

Screenshot docs/demo-final.png
Sleep 2s
