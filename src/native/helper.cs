using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Reports held keys (terminals only deliver key presses, never releases) and plays
// sounds through MCI so several can overlap. Protocol on stdin, one command per line:
//   keys <vk>,<vk>,...   start polling these virtual keys; emits "K <bitmask>" on change
//   mci <command>        mciSendString; failures are reported as "E <code> <command>"
public static class ClaudeInvadersHelper
{
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vk);

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern int mciSendStringW(string command, StringBuilder ret, int retLength, IntPtr callback);

    public static void Main()
    {
        var queue = new ConcurrentQueue<string>();
        var reader = new Thread(() =>
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                queue.Enqueue(line);
            }
            queue.Enqueue("quit");
        });
        reader.IsBackground = true;
        reader.Start();

        int[] keys = new int[0];
        int last = -1;
        while (true)
        {
            string cmd;
            while (queue.TryDequeue(out cmd))
            {
                if (cmd == "quit")
                {
                    mciSendStringW("close all", null, 0, IntPtr.Zero);
                    return;
                }
                if (cmd.StartsWith("keys "))
                {
                    string[] parts = cmd.Substring(5).Split(',');
                    keys = new int[parts.Length];
                    for (int i = 0; i < parts.Length; i++)
                    {
                        keys[i] = int.Parse(parts[i]);
                    }
                    last = -1;
                }
                else if (cmd.StartsWith("mci "))
                {
                    string mci = cmd.Substring(4);
                    int code = mciSendStringW(mci, null, 0, IntPtr.Zero);
                    if (code != 0)
                    {
                        Console.Out.WriteLine("E " + code + " " + mci);
                        Console.Out.Flush();
                    }
                }
            }

            int mask = 0;
            for (int i = 0; i < keys.Length; i++)
            {
                if ((GetAsyncKeyState(keys[i]) & 0x8000) != 0)
                {
                    mask |= 1 << i;
                }
            }
            if (mask != last && keys.Length > 0)
            {
                Console.Out.WriteLine("K " + mask);
                Console.Out.Flush();
                last = mask;
            }
            Thread.Sleep(8);
        }
    }
}
