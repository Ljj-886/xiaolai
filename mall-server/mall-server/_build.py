# -*- coding: utf-8 -*-
import os
import subprocess
import sys

PROJ = r"D:\xiangmu\作业\商城(3)\mall-server"
MVN_HOME = r"C:\Users\llx\.m2\wrapper\dists\apache-maven-3.9.12\59fe215c0ad6947fea90184bf7add084544567b927287592651fda3782e0e798"
JAVA_HOME = r"C:\Program Files\Java\jdk-21"

cmd = [
    os.path.join(JAVA_HOME, "bin", "java.exe"),
    "-classpath", os.path.join(MVN_HOME, "boot", "plexus-classworlds-2.9.0.jar"),
    "-Dclassworlds.conf=" + os.path.join(MVN_HOME, "bin", "m2.conf"),
    "-Dmaven.home=" + MVN_HOME,
    "-Dmaven.multiModuleProjectDirectory=" + PROJ,
    "org.codehaus.plexus.classworlds.launcher.Launcher",
    "-o", "clean", "package", "-DskipTests",
]
env = dict(os.environ)
env["JAVA_HOME"] = JAVA_HOME
r = subprocess.run(cmd, cwd=PROJ, env=env, capture_output=True)
out = ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", "replace")
print("\n".join(out.strip().splitlines()[-30:]))
print("EXIT:", r.returncode)
sys.exit(r.returncode)
