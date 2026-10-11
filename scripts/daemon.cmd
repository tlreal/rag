@echo off
cd /d D:\tools\githubfiel\rag
"D:\Program Files\nodejs\node.exe" src\daemon.cjs >> data\daemon.out.log 2>> data\daemon.err.log
