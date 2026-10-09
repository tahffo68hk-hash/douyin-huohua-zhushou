#!/usr/bin/env python3
"""抖音火花助手 Full - Tkinter 多账号与 Profile 管理器（不存储账号密码）。"""
from __future__ import annotations
import copy
import datetime as dt
import json
import os
import secrets
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from scheduler import CONFIG, ROOT, browser_executable, launch_account, resolve_profile, load_config

EXAMPLE=ROOT/'config.example.json'

def ensure_config():
    if not CONFIG.exists():
        raw=json.loads(EXAMPLE.read_text(encoding='utf-8'))
        # 初次启动不添加虚构的默认账号
        raw['accounts']=[]
        CONFIG.write_text(json.dumps(raw,ensure_ascii=False,indent=2),encoding='utf-8')

def write_config(cfg):
    tmp=CONFIG.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,CONFIG)

class AccountEditor(tk.Toplevel):
    def __init__(self,app,record=None):
        super().__init__(app)
        self.app=app;self.record=record;self.title('编辑账号' if record else '添加账号')
        self.geometry('560x320');self.transient(app);self.grab_set();self.resizable(False,False)
        current=record or {}
        self.fields={}
        defaults={'name':'','browser':'chrome','profile_path':'profiles/account1','send_time':app.config.get('send_time','20:30'),'callback_token':secrets.token_urlsafe(24)}
        for i,(key,label) in enumerate([('name','账号备注'),('browser','浏览器'),('profile_path','独立 Profile 文件夹'),('send_time','每日 HH:mm'),('callback_token','回调鉴权令牌')]):
            ttk.Label(self,text=label).grid(row=i,column=0,padx=10,pady=8,sticky='w')
            var=tk.StringVar(value=str(current.get(key,defaults[key])));self.fields[key]=var
            if key=='browser':ttk.Combobox(self,textvariable=var,values=['chrome','edge','firefox','firefox-esr','centbrowser'],state='readonly',width=42).grid(row=i,column=1,padx=8,pady=7,sticky='we')
            else:ttk.Entry(self,textvariable=var,width=52).grid(row=i,column=1,padx=8,pady=7,sticky='we')
        ttk.Label(self,text='需在浏览器火花助手「高级」填入同一回调令牌。请勿公开此令牌。',foreground='#555').grid(row=5,column=0,columnspan=2,pady=8)
        row=ttk.Frame(self);row.grid(row=6,column=0,columnspan=2,pady=8)
        ttk.Button(row,text='保存',command=self.save).pack(side=tk.LEFT,padx=8)
        ttk.Button(row,text='取消',command=self.destroy).pack(side=tk.LEFT,padx=8)
        self.columnconfigure(1,weight=1)
    def save(self):
        v={k:x.get().strip() for k,x in self.fields.items()}
        if not v['name']:return messagebox.showerror('错误','账号备注不能为空',parent=self)
        if v['browser'] not in {'chrome','edge','firefox','firefox-esr','centbrowser'}:return messagebox.showerror('错误','浏览器类型不正确',parent=self)
        if len(v['callback_token'])<16:return messagebox.showerror('错误','令牌最少需要 16 个字符',parent=self)
        try:dt.time.fromisoformat(v['send_time'])
        except ValueError:return messagebox.showerror('错误','时间格式必须 HH:mm',parent=self)
        names=[a['name'] for a in self.app.config['accounts'] if a is not self.record]
        if v['name'] in names:return messagebox.showerror('错误','账号备注重复',parent=self)
        if self.record:self.record.update(v)
        else:self.app.config['accounts'].append(v)
        self.app.persist();self.app.refresh_accounts();self.destroy()

class Manager(tk.Tk):
    def __init__(self):
        super().__init__()
        ensure_config()
        self.config=json.loads(CONFIG.read_text(encoding='utf-8'))
        self.proc=None;self.title('🔥 抖音火花助手 Full · 多账号管理器')
        self.geometry('920x700');self.minsize(740,520)
        self.build_ui();self.refresh_accounts();self.protocol('WM_DELETE_WINDOW',self.on_close)

    def build_ui(self):
        top=ttk.Frame(self,padding=12);top.pack(fill=tk.X)
        ttk.Label(top,text='抖音火花助手 Full',font=('Microsoft YaHei UI',16,'bold')).pack(side=tk.LEFT)
        ttk.Label(top,text='本地多账号管理 · 需手动扫码登录 · 不保存密码',foreground='#555').pack(side=tk.RIGHT)
        self.nb=ttk.Notebook(self);self.nb.pack(fill=tk.BOTH,expand=True,padx=12,pady=6)
        self.accounts_tab=ttk.Frame(self.nb,padding=10);self.config_tab=ttk.Frame(self.nb,padding=10);self.logs_tab=ttk.Frame(self.nb,padding=10)
        self.nb.add(self.accounts_tab,text='账号与浏览器');self.nb.add(self.config_tab,text='全局配置');self.nb.add(self.logs_tab,text='日志')
        cols=('name','browser','send_time','profile_path','enabled')
        self.tree=ttk.Treeview(self.accounts_tab,columns=cols,show='headings',height=14,selectmode='browse')
        for key,name,width in [('name','账号名称',125),('browser','浏览器',90),('send_time','发送时间',90),('profile_path','Profile 文件夹',340),('enabled','启用',65)]:
            self.tree.heading(key,text=name);self.tree.column(key,width=width,anchor='w')
        self.tree.pack(fill=tk.BOTH,expand=True)
        row=ttk.Frame(self.accounts_tab);row.pack(fill=tk.X,pady=9)
        for label,method in [('添加账号',self.add_account),('修改',self.edit_account),('移除',self.remove_account),('打开账号',self.open_account),('复制 Profile',self.clone_profile),('删除 Profile',self.delete_profile)]:
            ttk.Button(row,text=label,command=method).pack(side=tk.LEFT,padx=3)
        row2=ttk.Frame(self.accounts_tab);row2.pack(fill=tk.X,pady=5)
        for label,callback in [('检查配置',lambda:self.run_scheduler('check')),('立即尝试 once',lambda:self.run_scheduler('once')),('启动每日调度',lambda:self.run_scheduler('daemon')),('停止调度',self.stop_scheduler)]:
            ttk.Button(row2,text=label,command=callback).pack(side=tk.LEFT,padx=4)
        ttk.Label(self.accounts_tab,text='提示：第一次先点「打开账号」，在独立浏览器 Profile 中安装脚本并扫码登录；开启脚本定时及回调并配置匹配的令牌。',foreground='#555',wraplength=820).pack(anchor='w',pady=10)
        fields=[('send_time','默认 HH:mm'),('callback_port','监听端口'),('timeout_seconds','单个账号等待秒数'),('retry_wait_minutes','重试等待分钟'),('default_browser','默认浏览器'),('target_url','抖音聊天页面 URL')]
        self.global_vars={}
        for i,(key,title) in enumerate(fields):
            ttk.Label(self.config_tab,text=title).grid(row=i,column=0,pady=11,padx=8,sticky='w')
            var=tk.StringVar(value=str(self.config.get(key,'')));self.global_vars[key]=var
            ttk.Entry(self.config_tab,textvariable=var,width=62).grid(row=i,column=1,pady=8,sticky='we')
        bps=self.config.get('browser_paths',{});self.browser_vars={}
        for j,key in enumerate(['chrome','edge','firefox','firefox-esr','centbrowser'],start=len(fields)):
            ttk.Label(self.config_tab,text=f'{key} 可执行文件路径（可空）').grid(row=j,column=0,padx=8,pady=8,sticky='w')
            var=tk.StringVar(value=bps.get(key,''));self.browser_vars[key]=var
            ttk.Entry(self.config_tab,textvariable=var,width=62).grid(row=j,column=1,padx=8,pady=8,sticky='we')
            ttk.Button(self.config_tab,text='选择',command=lambda k=key:self.pick_browser(k)).grid(row=j,column=2,padx=6)
        ttk.Button(self.config_tab,text='保存配置',command=self.save_global).grid(row=len(fields)+5,column=1,sticky='w',pady=12)
        self.config_tab.columnconfigure(1,weight=1)
        self.logarea=tk.Text(self.logs_tab,wrap='word',font=('Consolas',10),state='disabled')
        self.logarea.pack(fill=tk.BOTH,expand=True)
        ttk.Button(self.logs_tab,text='清空显示',command=self.clear_logs).pack(anchor='e',pady=5)
        self.status=tk.StringVar(value='就绪');ttk.Label(self,textvariable=self.status,anchor='w',relief=tk.SUNKEN).pack(fill=tk.X,side=tk.BOTTOM)

    def log(self,line):
        self.logarea.configure(state='normal');self.logarea.insert('end',line+'\n');self.logarea.see('end');self.logarea.configure(state='disabled')
    def clear_logs(self):
        self.logarea.configure(state='normal');self.logarea.delete('1.0','end');self.logarea.configure(state='disabled')
    def persist(self):write_config(self.config);self.status.set('配置已保存至 tools/config.json')
    def refresh_accounts(self):
        for item in self.tree.get_children():self.tree.delete(item)
        for idx,a in enumerate(self.config['accounts']):
            self.tree.insert('',tk.END,iid=str(idx),values=(a['name'],a.get('browser','chrome'),a.get('send_time',''),a.get('profile_path',''), '是' if a.get('enabled',True) else '否'))
    def current(self):
        picked=self.tree.selection()
        if not picked:messagebox.showinfo('提示','请先选中账号',parent=self);return None
        return self.config['accounts'][int(picked[0])]
    def add_account(self):AccountEditor(self)
    def edit_account(self):
        if a:=self.current():AccountEditor(self,a)
    def remove_account(self):
        a=self.current()
        if a and messagebox.askyesno('确认移除',f'移除 {a["name"]} 的配置？不会删除 Profile 文件夹。',parent=self):
            self.config['accounts'].remove(a);self.persist();self.refresh_accounts()
    def open_account(self):
        a=self.current()
        if not a:return
        try:
            self.persist()
            launch_account(a,self.config);self.log(f"已启动账号：{a['name']}（请手动完成网页登录）")
        except Exception as e:messagebox.showerror('无法打开',str(e),parent=self)
    def clone_profile(self):
        a=self.current()
        if not a:return
        name=simpledialog.askstring('复制 Profile','请输入新的账号备注：',parent=self)
        if not name:return
        if any(x['name']==name for x in self.config['accounts']):return messagebox.showerror('错误','备注已存在',parent=self)
        if not messagebox.askyesno('安全提示','复制浏览器 Profile 会复制网页登录会话等敏感数据。请确保浏览器已退出、目标文件夹安全，且只供本人使用。确认复制？',parent=self):return
        try:
            src=resolve_profile(a['profile_path']);target=ROOT/'profiles'/f'copy_{int(dt.datetime.now().timestamp())}'
            if target.exists():raise FileExistsError(target)
            shutil.copytree(src,target)
            new=copy.deepcopy(a);new.update(name=name,profile_path=str(target),callback_token=secrets.token_urlsafe(24))
            self.config['accounts'].append(new);self.persist();self.refresh_accounts();self.log('已复制 Profile；请更新新账号脚本回调令牌，并确认登录账号是否正确。')
        except Exception as e:messagebox.showerror('复制失败',str(e),parent=self)
    def delete_profile(self):
        a=self.current()
        if not a:return
        path=resolve_profile(a['profile_path']);allowed=(ROOT/'profiles').resolve()
        if allowed not in path.parents:return messagebox.showerror('限制','仅允许删除工具目录下的 profiles 子目录',parent=self)
        if not messagebox.askyesno('危险操作',f'此操作将永久删除该账号的全部浏览器数据，包括登录状态：\n{path}\n确定？',parent=self):return
        if simpledialog.askstring('二次确认','输入 DELETE 确认：',parent=self)!='DELETE':return
        try:shutil.rmtree(path);self.log(f'已删除：{path}')
        except Exception as e:messagebox.showerror('删除失败',str(e),parent=self)
    def pick_browser(self,key):
        path=filedialog.askopenfilename(parent=self,title='选择浏览器程序')
        if path:self.browser_vars[key].set(path)
    def save_global(self):
        try:
            for key,var in self.global_vars.items():
                val=var.get().strip();self.config[key]=int(val) if key in ('callback_port','timeout_seconds','retry_wait_minutes') else val
            self.config['browser_paths']={key:v.get().strip() for key,v in self.browser_vars.items()}
            if self.config['target_url']!='https://www.douyin.com/chat':raise ValueError('目标 URL 必须是 https://www.douyin.com/chat')
            self.persist();messagebox.showinfo('已保存','全局配置保存成功',parent=self)
        except Exception as e:messagebox.showerror('校验失败',str(e),parent=self)
    def run_scheduler(self,mode):
        if self.proc and self.proc.poll() is None:return messagebox.showinfo('提示','已有调度任务运行中',parent=self)
        self.persist();self.nb.select(self.logs_tab)
        cmd=[sys.executable,str(ROOT/'scheduler.py'),mode]
        self.proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',bufsize=1)
        self.status.set('已启动 scheduler.py '+mode)
        def reader():
            for line in self.proc.stdout:self.after(0,lambda x=line:self.log(x.rstrip()))
            code=self.proc.wait();self.after(0,lambda:self.status.set(f'调度进程退出：{code}'))
        threading.Thread(target=reader,daemon=True).start()
    def stop_scheduler(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate();self.log('正在停止调度器…')
    def on_close(self):
        if self.proc and self.proc.poll() is None:
            if not messagebox.askyesno('关闭管理器','调度器正在运行。结束调度并退出？',parent=self):return
            self.stop_scheduler()
        self.destroy()
if __name__=='__main__':Manager().mainloop()
