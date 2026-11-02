import os, re

ROOT = r'D:\商城'
PAGES = os.path.join(ROOT, 'pages')
CLOUD = os.path.join(ROOT, 'cloudfunctions')

RESERVED = {
    'onLoad','onShow','onReady','onHide','onUnload','onPullDownRefresh','onReachBottom',
    'onShareAppMessage','onShareTimeline','onAddToFavorites','onPageScroll','onTabItemTap',
    'onResize','onSaveExitState','onTitleClick','onOptionMenuClick','onPopMenuClick',
    'onPullIntercept','onBack','onKeyboardHeightChange','data','lifetimes','pageLifetimes',
    'methods','options','behaviors','created','attached','detached','observers','relations',
    'externalClasses','properties','setData','selectComponent','triggerEvent'
}

cloud_funcs = set(d for d in os.listdir(CLOUD) if os.path.isdir(os.path.join(CLOUD, d)))

def parse_js_methods(js):
    methods = set()
    for m in re.findall(r'(?:^|[\n},])\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{', js):
        methods.add(m)
    for m in re.findall(r'(?:^|[\n},])\s*([A-Za-z_$][\w$]*)\s*:\s*(?:function|async|\()', js):
        methods.add(m)
    for m in re.findall(r'(?:^|[\n},])\s*([A-Za-z_$][\w$]*)\s*:\s*\([^)]*\)\s*=>', js):
        methods.add(m)
    return methods

def parse_wxml_handlers(wxml):
    handlers = []
    for m in re.findall(r'(?:bind|catch)(?::[\w]+|[\w]*)\s*=\s*[\'"]([^\'"]+)[\'"]', wxml):
        if '{' in m or '}' in m or '(' in m or ' ' in m:
            continue
        handlers.append(m.split('.')[0])
    return handlers

def check_requires(js, pdir):
    bad = []
    for r in re.findall(r'require\([\'"]([^\'"]+)[\'"]\)', js):
        if r.startswith('.'):
            target = os.path.normpath(os.path.join(pdir, r))
            if not os.path.exists(target):
                bad.append(r)
    return bad

def check_cloud_calls(js):
    calls = set()
    for m in re.findall(r"call\(['\"]([\w]+)['\"]", js):
        calls.add(m)
    for m in re.findall(r"callFunction\(\{[^}]*name:\s*['\"]([\w]+)['\"]", js, re.S):
        calls.add(m)
    return calls

# onShow 全量覆盖隐患：onShow 函数体内出现 fetchMe/fetchData/loadXxx 且同时 setData 覆盖 form/list 之类
def scan_onshow_overwrite(js):
    m = re.search(r'onShow\s*\([^)]*\)\s*\{(.*?)\n  \}', js, re.S)
    if not m:
        m = re.search(r'onShow\s*\([^)]*\)\s*\{(.*)\}', js, re.S)
    if not m:
        return None
    body = m.group(1)
    if re.search(r'(fetchMe|fetchData|loadList|loadData|getMe|fetchProfile)', body) and re.search(r"setData\(\{\s*form\s*:", body):
        return True
    return False

issues = []
func_report = {}
require_report = {}
onshow_report = {}

for page in sorted(os.listdir(PAGES)):
    pdir = os.path.join(PAGES, page)
    if not os.path.isdir(pdir):
        continue
    js_files = [f for f in os.listdir(pdir) if f.endswith('.js')]
    wxml_files = [f for f in os.listdir(pdir) if f.endswith('.wxml')]
    if not js_files:
        issues.append(f'[{page}] 缺少 .js 文件')
        continue
    js_path = os.path.join(pdir, js_files[0])
    js = open(js_path, encoding='utf-8').read()
    methods = parse_js_methods(js)
    whandlers = []
    if wxml_files:
        wxml = open(os.path.join(pdir, wxml_files[0]), encoding='utf-8').read()
        whandlers = parse_wxml_handlers(wxml)
    missing = [h for h in sorted(set(whandlers)) if h not in methods and h not in RESERVED]
    if missing:
        issues.append(f'[{page}] ❌ wxml 引用但 js 未定义: {missing}')
    bad = check_requires(js, pdir)
    if bad:
        require_report[page] = bad
    for c in check_cloud_calls(js):
        if c not in cloud_funcs:
            func_report.setdefault(page, []).append(c)
    ov = scan_onshow_overwrite(js)
    if ov:
        onshow_report[page] = True

print('=== 1) 疑似缺失方法 (wxml 绑定但 js 无定义) ===')
print('\n'.join(issues) if issues else '  （无）')
print('\n=== 2) 云函数调用名不在 cloudfunctions/ 目录 ===')
print('\n'.join(f'  {p}: {v}' for p, v in func_report.items()) if func_report else '  （无）')
print('\n=== 3) require 路径不存在 ===')
print('\n'.join(f'  {p}: {v}' for p, v in require_report.items()) if require_report else '  （无）')
print('\n=== 4) onShow 疑似全量覆盖隐患 ===')
print('\n'.join(f'  {p}' for p in onshow_report) if onshow_report else '  （无）')
print('\n扫描完成。存在的云函数:', sorted(cloud_funcs))
