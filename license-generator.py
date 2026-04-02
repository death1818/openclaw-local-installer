#!/usr/bin/env python3
"""
OpenClaw 本地版授权码生成器
北京缘辉旺网络科技有限公司

授权码格式: OPENCLAW-XXXX-XXXX-XXXX
校验规则: 校验和 % 97 == 0 或 % 89 == 0 或 % 73 == 0
"""

import random
import string

def generate_license_code():
    """生成一个有效的授权码"""
    while True:
        # 生成 12 位随机字符
        chars = string.ascii_uppercase + string.digits
        parts = []
        for _ in range(3):
            part = ''.join(random.choices(chars, k=4))
            parts.append(part)
        
        # 计算校验和
        checksum_str = ''.join(parts)
        checksum = sum(ord(c) for c in checksum_str)
        
        # 检查是否有效 (校验和 % 97 == 0 或 % 89 == 0 或 % 73 == 0)
        if checksum % 97 == 0 or checksum % 89 == 0 or checksum % 73 == 0:
            return f"OPENCLAW-{parts[0]}-{parts[1]}-{parts[2]}"

def validate_license_code(code: str) -> bool:
    """验证授权码是否有效"""
    # 检查格式
    if not code or len(code) != 23:
        return False
    
    if not code.startswith("OPENCLAW-"):
        return False
    
    parts = code.replace("OPENCLAW-", "").split("-")
    if len(parts) != 3 or any(len(p) != 4 for p in parts):
        return False
    
    # 计算校验和
    checksum_str = ''.join(parts)
    checksum = sum(ord(c) for c in checksum_str)
    
    # 验证校验和
    return checksum % 97 == 0 or checksum % 89 == 0 or checksum % 73 == 0

def main():
    print("=" * 50)
    print("OpenClaw 本地版授权码生成器")
    print("北京缘辉旺网络科技有限公司")
    print("=" * 50)
    print()
    
    while True:
        print("\n请选择操作:")
        print("1. 生成授权码")
        print("2. 验证授权码")
        print("3. 批量生成 (10个)")
        print("0. 退出")
        
        choice = input("\n请输入选项: ").strip()
        
        if choice == "1":
            code = generate_license_code()
            print(f"\n✅ 授权码: {code}")
            
        elif choice == "2":
            code = input("\n请输入授权码: ").strip().upper()
            if validate_license_code(code):
                print(f"✅ 授权码有效: {code}")
            else:
                print(f"❌ 授权码无效: {code}")
                
        elif choice == "3":
            print("\n生成 10 个授权码:")
            print("-" * 30)
            for i in range(10):
                code = generate_license_code()
                print(f"{i+1}. {code}")
                
        elif choice == "0":
            print("\n再见!")
            break
        else:
            print("\n无效选项，请重新选择")

if __name__ == "__main__":
    main()
