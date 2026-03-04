@echo off
echo Deploying MixinClaw...
xcopy "E:\AI\mixin-claw\*" "C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin\" /E /I /Y /EXCLUDE:E:\AI\mixin-claw\.deployexclude
echo Done!
pause
