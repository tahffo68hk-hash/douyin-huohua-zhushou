import os
import shutil
import sys
from pathlib import Path


def chromium_executable():
    override = os.environ.get('CHROMIUM')
    if override:
        return override

    for name in ('chromium', 'chromium-browser', 'chrome', 'google-chrome'):
        found = shutil.which(name)
        if found:
            return found

    if os.name == 'nt':
        program_files = Path(os.environ.get('PROGRAMFILES', r'C:\Program Files'))
        program_files_x86 = Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'))
        local_app_data = Path(os.environ.get('LOCALAPPDATA', Path.home()))
        candidates = (
            program_files / 'Google' / 'Chrome' / 'Application' / 'chrome.exe',
            program_files_x86 / 'Google' / 'Chrome' / 'Application' / 'chrome.exe',
            local_app_data / 'Google' / 'Chrome' / 'Application' / 'chrome.exe',
        )
        for path in candidates:
            if path.is_file():
                return str(path)

    if sys.platform == 'darwin':
        candidates = (
            Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
            Path('/Applications/Chromium.app/Contents/MacOS/Chromium'),
        )
        for path in candidates:
            if path.is_file():
                return str(path)

    return '/usr/bin/chromium'
