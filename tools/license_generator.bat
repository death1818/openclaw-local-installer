@echo off
chcp 65001 >nul
title OpenClaw 授权码生成器

echo ================================================
echo     OpenClaw 授权码生成器
echo     北京缘辉旺网络科技有限公司
echo ================================================
echo.

:menu
echo 请选择操作:
echo [1] 生成单个授权码
echo [2] 批量生成 10 个授权码
echo [3] 验证授权码
echo [4] 退出
echo.
set /p choice=请输入选项: 

if "%choice%"=="1" goto single
if "%choice%"=="2" goto batch
if "%choice%"=="3" goto verify
if "%choice%"=="4" goto end
goto menu

:single
echo.
python license_generator.py --generate
echo.
pause
goto menu

:batch
echo.
python license_generator.py --batch 10
echo.
pause
goto menu

:verify
echo.
set /p code=请输入授权码: 
python license_generator.py --verify %code%
echo.
pause
goto menu

:end
exit
