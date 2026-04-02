#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenClaw 本地版授权码生成器（命令行版本）
北京缘辉旺网络科技有限公司

授权码格式: OPENCLAW-XXXX-XXXX-XXXX
"""

import random
import string
import sys

def generate_license_code():
    """生成一个有效的授权码"""
    chars = string.ascii_uppercase + string.digits
    
    while True:
        parts = []
        for _ in range(3):
            part = ''.join(random.choices(chars, k=4))
            parts.append(part)
        
        checksum_str = ''.join(parts)
        checksum = sum(ord(c) for c in checksum_str)
        
        if checksum % 97 == 0 or checksum % 89 == 0 or checksum % 73 == 0:
            return f"OPENCLAW-{parts[0]}-{parts[1]}-{parts[2]}"

def validate_license_code(code):
    """验证授权码是否有效"""
    if not code or len(code) != 23:
        return False
    
    if not code.startswith("OPENCLAW-"):
        return False
    
    parts = code.replace("OPENCLAW-", "").split("-")
    if len(parts) != 3 or any(len(p) != 4 for p in parts):
        return False
    
    checksum_str = ''.join(parts)
    checksum = sum(ord(c) for c in checksum_str)
    
    return checksum % 97 == 0 or checksum % 89 == 0 or checksum % 73 == 0

def main():
    if len(sys.argv) < 2:
        print("用法:")
        print("  python license_generator.py --generate    生成单个授权码")
        print("  python license_generator.py --batch N     批量生成 N 个授权码")
        print("  python license_generator.py --verify CODE 验证授权码")
        return
    
    cmd = sys.argv[1]
    
    if cmd == "--generate":
        code = generate_license_code()
        print(f"✅ 授权码: {code}")
    
    elif cmd == "--batch":
        try:
            count = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        except:
            count = 10
        
        print(f"\n生成 {count} 个授权码:")
        print("-" * 30)
        for i in range(count):
            code = generate_license_code()
            print(f"{i+1}. {code}")
    
    elif cmd == "--verify":
        if len(sys.argv) < 3:
            print("❌ 请输入授权码")
            return
        
        code = sys.argv[2].upper()
        if validate_license_code(code):
            print(f"✅ 授权码有效: {code}")
        else:
            print(f"❌ 授权码无效: {code}")
    
    else:
        print(f"未知命令: {cmd}")

if __name__ == "__main__":
    main()
