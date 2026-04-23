package com.neondefense.game;

import android.app.Application;
import android.content.Context;
import android.os.Build;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;

public class NeonDefenseApp extends Application {

    public static final String CRASH_FILE = "crash.txt";

    @Override
    public void onCreate() {
        super.onCreate();
        installCrashHandler(this);
    }

    public static void installCrashHandler(final Context ctx) {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    writeCrash(ctx, t, e);
                } catch (Throwable ignored) {
                }
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
    }

    public static void writeCrash(Context ctx, Thread t, Throwable e) {
        try {
            StringWriter sw = new StringWriter();
            PrintWriter pw = new PrintWriter(sw);
            pw.println("=== Neon Defense crash ===");
            pw.println("Android SDK: " + Build.VERSION.SDK_INT
                    + " (" + Build.VERSION.RELEASE + ")");
            pw.println("Device: " + Build.MANUFACTURER + " " + Build.MODEL
                    + " (" + Build.DEVICE + ")");
            pw.println("Thread: " + (t != null ? t.getName() : "?"));
            pw.println();
            if (e != null) {
                e.printStackTrace(pw);
            } else {
                pw.println("(no throwable)");
            }
            pw.flush();

            File f = new File(ctx.getFilesDir(), CRASH_FILE);
            FileWriter fw = new FileWriter(f, false);
            fw.write(sw.toString());
            fw.close();
        } catch (Throwable ignored) {
        }
    }

    public static String readCrashAndClear(Context ctx) {
        File f = new File(ctx.getFilesDir(), CRASH_FILE);
        if (!f.exists()) return null;
        try {
            java.io.FileInputStream fis = new java.io.FileInputStream(f);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = fis.read(buf)) > 0) bos.write(buf, 0, n);
            fis.close();
            String s = bos.toString("UTF-8");
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            return s;
        } catch (Throwable ignored) {
            return null;
        }
    }
}
