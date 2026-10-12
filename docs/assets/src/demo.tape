# Terminal recording of the real demo. Regenerate with: vhs docs/assets/src/demo.tape
# The typing pace is scripted. The command output comes from the real MOZAK CLI.
Output docs/assets/demo-terminal.gif

Set Shell "bash"
Set FontSize 15
Set Width 960
Set Height 520
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set PlaybackSpeed 1.0
Set Framerate 20

Hide
Type "cd $(git rev-parse --show-toplevel) && clear" Enter
Show

Type "node docs/assets/src/demo-flow.mjs" Sleep 600ms Enter
Sleep 50s
