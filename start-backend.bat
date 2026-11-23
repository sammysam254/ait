@echo off
title Vertex SaaS Backend Server
cd /d "%~dp0backend"
echo =======================================================
echo  Starting Vertex SaaS Backend API on Port 5000...
echo =======================================================
node dist/server.js
pause
