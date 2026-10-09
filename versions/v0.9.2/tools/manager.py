#!/usr/bin/env python3
"""Small local multi-profile manager for Spark. No credential storage."""
import argparse
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys

DEFAULT = {"send_time":"20:30","callback_port":7788,"callback_token":"", "timeout_seconds":300,"between_accounts_seconds":2,"close_launched_browser":False,"accounts":[]}

def init_config(path:Path):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    cfg = {**DEFAULT, "callback_token":secrets.token_urlsafe(32)}
    save_config(path,cfg)
    return cfg

def save_config(path:Path,cfg:dict):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+"\n", encoding="utf-8")
    try:path.chmod(0o600)
    except OSError:pass

def gui(path:Path):
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    cfg=init_config(path)
    root=tk.Tk();root.title("抖音火花助手 · 多账号管理");root.geometry("650x515")
    pane=ttk.Frame(root,padding=14);pane.pack(fill='both',expand=True)
    ttk.Label(pane,text="各账号使用独立 Chrome Profile。每个 Profile 都要安装油猴脚本并启用高级定时及本地回调。",wraplength=600).pack(anchor='w')
    frame=ttk.LabelFrame(pane,text='本机调度配置');frame.pack(fill='x',pady=8)
    time_var=tk.StringVar(value=cfg.get('send_time','20:30'));port_var=tk.StringVar(value=str(cfg.get('callback_port',7788)))
    ttk.Label(frame,text='每日启动时间 HH:MM').grid(row=0,column=0,padx=8,pady=8,sticky='w')
    ttk.Entry(frame,textvariable=time_var,width=12).grid(row=0,column=1,sticky='w')
    ttk.Label(frame,text='回调端口').grid(row=0,column=2,padx=8,sticky='w')
    ttk.Entry(frame,textvariable=port_var,width=8).grid(row=0,column=3,sticky='w')
    ttk.Label(frame,text='回调令牌（本机保存，不传到聊天或云端）').grid(row=1,column=0,columnspan=3,padx=8,sticky='w')
    token_var=tk.StringVar(value=cfg['callback_token']);ttk.Entry(frame,textvariable=token_var,width=48,show='•').grid(row=2,column=0,columnspan=4,padx=8,sticky='w')
    table=ttk.Treeview(pane,columns=('id','browser','profile'),show='headings',height=8)
    for key,title,width in [('id','账号标识',120),('browser','浏览器',125),('profile','独立 Profile 目录',350)]:table.heading(key,text=title);table.column(key,width=width)
    table.pack(fill='both',expand=True,pady=10)
    def refresh():
        for iid in table.get_children():table.delete(iid)
        for i,a in enumerate(cfg['accounts']):table.insert('', 'end', iid=str(i), values=(a['id'],a.get('browser','chrome'),a['profile_dir']))
    refresh()
    form=ttk.Frame(pane);form.pack(fill='x')
    id_var=tk.StringVar();browser_var=tk.StringVar(value='chrome');profile_var=tk.StringVar()
    for col,(label,var,width) in enumerate([('账号标识',id_var,14),('浏览器命令/路径',browser_var,17),('Profile 目录',profile_var,42)]):
        ttk.Label(form,text=label).grid(row=0,column=col,sticky='w',padx=4)
        ttk.Entry(form,textvariable=var,width=width).grid(row=1,column=col,sticky='w',padx=4)
    def add():
        aid=id_var.get().strip();prof=profile_var.get().strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,60}',aid) or not prof:
            messagebox.showerror('输入错误','账号标识限英文字母、数字、-、_，且 Profile 路径必填');return
        entry={'id':aid,'browser':browser_var.get().strip() or 'chrome','profile_dir':prof,'enabled':True}
        cfg['accounts']=[a for a in cfg['accounts'] if a['id']!=aid]+[entry];refresh()
    def delete():
        for iid in sorted(table.selection(),reverse=True):
            try:cfg['accounts'].pop(int(iid))
            except (ValueError,IndexError):pass
        refresh()
    def save():
        if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',time_var.get()):messagebox.showerror('错误','时间应为 HH:MM');return
        try:port=int(port_var.get());assert 1024<=port<=65535
        except (ValueError,AssertionError):messagebox.showerror('错误','端口应为 1024~65535');return
        cfg.update(send_time=time_var.get(),callback_port=port,callback_token=token_var.get())
        save_config(path,cfg);messagebox.showinfo('已保存',f'保存到：{path}\n将账号标识、端口、令牌填写到相应 Profile 中的油猴高级设置。')
    def test_launch():
        selected=table.selection()
        if not selected:messagebox.showinfo('提示','先在列表选一个账号');return
        save()
        aid=cfg['accounts'][int(selected[0])]['id']
        subprocess.Popen([sys.executable,str(Path(__file__).with_name('scheduler.py')),'--config',str(path),'--once','--account',aid])
    actions=ttk.Frame(pane);actions.pack(fill='x',pady=9)
    for label,command in [('添加/更新账号',add),('删除选中账号',delete),('保存配置',save),('启动所选账号并等待回调',test_launch)]:ttk.Button(actions,text=label,command=command).pack(side='left',padx=3)
    root.mainloop()

def main():
    ap=argparse.ArgumentParser(description='Spark profile manager')
    ap.add_argument('--config',type=Path,default=Path(__file__).with_name('config.json'))
    ap.add_argument('--init',action='store_true');ap.add_argument('--list',action='store_true');ap.add_argument('--show-token',action='store_true');ap.add_argument('--gui',action='store_true')
    a=ap.parse_args();cfg=init_config(a.config)
    if a.list:
        for account in cfg['accounts']:print(account['id'],account.get('browser','chrome'),account['profile_dir'])
    elif a.show_token:print(cfg['callback_token'])
    elif a.gui or not any([a.init,a.list,a.show_token]):gui(a.config)
    else:print(f'Created/loaded {a.config}')
if __name__=='__main__':main()
