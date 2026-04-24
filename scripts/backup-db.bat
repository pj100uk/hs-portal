@echo off
cd /d E:\hs-portal
node scripts\backup-db.js >> backups\backup.log 2>&1
