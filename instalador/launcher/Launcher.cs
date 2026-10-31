// Lançador do Reparo360. O mesmo código vira três executáveis; o NOME do arquivo escolhe a ação:
//   Instalar-Reparo360.exe -> instalador\instalar.ps1
//   Iniciar-Reparo360.exe  -> instalador\iniciar.ps1
//   Parar-Reparo360.exe    -> instalador\parar.ps1
// Ele só chama o script da pasta (com a política de execução liberada apenas para essa chamada).
// Não baixa nada, não pede administrador e não mexe em nada fora da pasta do projeto.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class Launcher
{
    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string self = Process.GetCurrentProcess().MainModule.FileName;
        string dir = Path.GetDirectoryName(self);
        string name = Path.GetFileNameWithoutExtension(self).ToLowerInvariant();

        string script = name.StartsWith("instalar") ? "instalar.ps1"
                      : name.StartsWith("iniciar") ? "iniciar.ps1"
                      : name.StartsWith("parar") ? "parar.ps1" : null;
        if (script == null)
        {
            Console.WriteLine("Nome de arquivo não reconhecido: " + name);
            return 2;
        }

        string path = Path.Combine(dir, "instalador", script);
        if (!File.Exists(path))
        {
            Console.WriteLine("Não encontrei " + path);
            Console.WriteLine("Mantenha este arquivo na pasta principal do Reparo360, junto da pasta 'instalador'.");
            Pause();
            return 3;
        }

        var info = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + path + "\"" + (args.Length > 0 ? " " + string.Join(" ", args) : ""),
            WorkingDirectory = dir,
            UseShellExecute = false
        };
        int code;
        try
        {
            using (Process p = Process.Start(info))
            {
                p.WaitForExit();
                code = p.ExitCode;
            }
        }
        catch (Exception e)
        {
            Console.WriteLine("Não consegui abrir o PowerShell: " + e.Message);
            code = 1;
        }

        if (code != 0) Console.WriteLine("\nTerminou com erro (código " + code + ").");
        Pause();
        return code;
    }

    // Duplo clique: espera Enter para a janela não fechar sozinha. Automação: REPARO360_SEM_PAUSA=1 ou -Silencioso.
    private static void Pause()
    {
        bool silent = Environment.GetEnvironmentVariable("REPARO360_SEM_PAUSA") == "1"
                      || Array.IndexOf(Environment.GetCommandLineArgs(), "-Silencioso") >= 0;
        if (silent) return;
        Console.WriteLine("\nPressione Enter para fechar.");
        Console.ReadLine();
    }
}
