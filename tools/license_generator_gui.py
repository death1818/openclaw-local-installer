#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenClaw 本地版授权码生成器
北京缘辉旺网络科技有限公司

授权码格式: OPENCLAW-XXXX-XXXX-XXXX
校验规则: 校验和 % 97 == 0 或 % 89 == 0 或 % 73 == 0
"""

import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import random
import string
import pyperclip

class LicenseGenerator:
    def __init__(self, root):
        self.root = root
        self.root.title("OpenClaw 授权码生成器")
        self.root.geometry("600x500")
        self.root.resizable(False, False)
        
        # 设置样式
        self.style = ttk.Style()
        self.style.configure('Title.TLabel', font=('微软雅黑', 16, 'bold'))
        self.style.configure('Info.TLabel', font=('微软雅黑', 10))
        self.style.configure('Big.TButton', font=('微软雅黑', 12))
        
        self.create_widgets()
    
    def create_widgets(self):
        # 标题
        title_frame = ttk.Frame(self.root, padding="10")
        title_frame.pack(fill=tk.X)
        
        ttk.Label(
            title_frame, 
            text="🔐 OpenClaw 授权码生成器",
            style='Title.TLabel'
        ).pack()
        
        ttk.Label(
            title_frame,
            text="北京缘辉旺网络科技有限公司",
            style='Info.TLabel'
        ).pack()
        
        ttk.Separator(self.root, orient='horizontal').pack(fill=tk.X, pady=10)
        
        # 单个生成
        single_frame = ttk.LabelFrame(self.root, text="生成单个授权码", padding="10")
        single_frame.pack(fill=tk.X, padx=20, pady=5)
        
        self.single_code_var = tk.StringVar()
        
        code_entry = ttk.Entry(
            single_frame, 
            textvariable=self.single_code_var,
            font=('Consolas', 14),
            justify='center'
        )
        code_entry.pack(fill=tk.X, pady=5)
        
        btn_frame = ttk.Frame(single_frame)
        btn_frame.pack(fill=tk.X, pady=5)
        
        ttk.Button(
            btn_frame, 
            text="🎲 生成授权码", 
            command=self.generate_single,
            style='Big.TButton'
        ).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=5)
        
        ttk.Button(
            btn_frame, 
            text="📋 复制", 
            command=self.copy_single,
            style='Big.TButton'
        ).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=5)
        
        # 批量生成
        batch_frame = ttk.LabelFrame(self.root, text="批量生成", padding="10")
        batch_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=5)
        
        btn_frame2 = ttk.Frame(batch_frame)
        btn_frame2.pack(fill=tk.X, pady=5)
        
        ttk.Label(btn_frame2, text="生成数量:").pack(side=tk.LEFT)
        
        self.count_var = tk.StringVar(value="10")
        count_spin = ttk.Spinbox(
            btn_frame2, 
            from_=1, 
            to=100,
            textvariable=self.count_var,
            width=5
        )
        count_spin.pack(side=tk.LEFT, padx=10)
        
        ttk.Button(
            btn_frame2, 
            text="批量生成", 
            command=self.generate_batch
        ).pack(side=tk.LEFT, padx=10)
        
        ttk.Button(
            btn_frame2, 
            text="📋 复制全部", 
            command=self.copy_batch
        ).pack(side=tk.LEFT, padx=10)
        
        # 结果显示
        self.result_text = scrolledtext.ScrolledText(
            batch_frame,
            height=10,
            font=('Consolas', 11)
        )
        self.result_text.pack(fill=tk.BOTH, expand=True, pady=5)
        
        # 验证授权码
        verify_frame = ttk.LabelFrame(self.root, text="验证授权码", padding="10")
        verify_frame.pack(fill=tk.X, padx=20, pady=5)
        
        verify_input_frame = ttk.Frame(verify_frame)
        verify_input_frame.pack(fill=tk.X)
        
        self.verify_code_var = tk.StringVar()
        
        ttk.Entry(
            verify_input_frame,
            textvariable=self.verify_code_var,
            font=('Consolas', 11),
            width=30
        ).pack(side=tk.LEFT, padx=5, expand=True, fill=tk.X)
        
        ttk.Button(
            verify_input_frame,
            text="✅ 验证",
            command=self.verify_code
        ).pack(side=tk.LEFT, padx=5)
        
        # 状态栏
        status_frame = ttk.Frame(self.root)
        status_frame.pack(fill=tk.X, pady=5)
        
        self.status_var = tk.StringVar(value="就绪")
        ttk.Label(
            status_frame, 
            textvariable=self.status_var,
            style='Info.TLabel'
        ).pack()
    
    def generate_license_code(self):
        """生成一个有效的授权码"""
        chars = string.ascii_uppercase + string.digits
        
        while True:
            # 生成 12 位随机字符
            parts = []
            for _ in range(3):
                part = ''.join(random.choices(chars, k=4))
                parts.append(part)
            
            # 计算校验和
            checksum_str = ''.join(parts)
            checksum = sum(ord(c) for c in checksum_str)
            
            # 检查是否有效
            if checksum % 97 == 0 or checksum % 89 == 0 or checksum % 73 == 0:
                return f"OPENCLAW-{parts[0]}-{parts[1]}-{parts[2]}"
    
    def validate_license_code(self, code):
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
    
    def generate_single(self):
        """生成单个授权码"""
        code = self.generate_license_code()
        self.single_code_var.set(code)
        self.status_var.set(f"✅ 已生成: {code}")
    
    def copy_single(self):
        """复制单个授权码"""
        code = self.single_code_var.get()
        if code:
            pyperclip.copy(code)
            self.status_var.set(f"✅ 已复制: {code}")
            messagebox.showinfo("成功", f"授权码已复制到剪贴板:\n{code}")
    
    def generate_batch(self):
        """批量生成授权码"""
        try:
            count = int(self.count_var.get())
            if count < 1 or count > 100:
                raise ValueError("数量必须在 1-100 之间")
        except ValueError as e:
            messagebox.showerror("错误", str(e))
            return
        
        codes = []
        for _ in range(count):
            codes.append(self.generate_license_code())
        
        self.result_text.delete(1.0, tk.END)
        for i, code in enumerate(codes, 1):
            self.result_text.insert(tk.END, f"{i}. {code}\n")
        
        self.status_var.set(f"✅ 已生成 {count} 个授权码")
    
    def copy_batch(self):
        """复制批量授权码"""
        text = self.result_text.get(1.0, tk.END).strip()
        if text:
            # 只复制授权码，不带序号
            codes = []
            for line in text.split('\n'):
                if line.strip():
                    code = line.split('. ')[1] if '. ' in line else line
                    codes.append(code)
            
            pyperclip.copy('\n'.join(codes))
            self.status_var.set(f"✅ 已复制 {len(codes)} 个授权码")
            messagebox.showinfo("成功", f"{len(codes)} 个授权码已复制到剪贴板")
    
    def verify_code(self):
        """验证授权码"""
        code = self.verify_code_var.get().strip().upper()
        
        if not code:
            messagebox.showwarning("警告", "请输入授权码")
            return
        
        if self.validate_license_code(code):
            self.status_var.set(f"✅ 授权码有效: {code}")
            messagebox.showinfo("验证成功", f"✅ 授权码有效\n\n{code}")
        else:
            self.status_var.set(f"❌ 授权码无效: {code}")
            messagebox.showerror("验证失败", f"❌ 授权码无效\n\n{code}")

def main():
    root = tk.Tk()
    app = LicenseGenerator(root)
    root.mainloop()

if __name__ == "__main__":
    main()
