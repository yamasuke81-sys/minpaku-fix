<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', '管理画面') — the Terrace 長浜</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen bg-cream">

    {{-- 管理画面ヘッダー --}}
    <header class="bg-navy text-white">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex items-center justify-between h-14">
                <div class="flex items-center gap-6">
                    <a href="{{ route('admin.dashboard') }}" class="text-base font-bold tracking-wide">
                        the Terrace 管理
                    </a>
                    <nav class="hidden sm:flex items-center gap-4">
                        <a href="{{ route('admin.dashboard') }}" class="text-sm text-white/70 hover:text-white transition">ダッシュボード</a>
                        {{-- 今後追加: 予約管理、カレンダー、料金設定、設定 --}}
                    </nav>
                </div>

                <div class="flex items-center gap-4">
                    <a href="{{ route('top') }}" target="_blank" class="text-xs text-white/50 hover:text-white/70 transition">サイトを表示</a>
                    <form method="POST" action="{{ route('logout') }}" class="inline">
                        @csrf
                        <button type="submit" class="text-sm text-white/70 hover:text-white transition">ログアウト</button>
                    </form>
                </div>
            </div>
        </div>
    </header>

    {{-- メインコンテンツ --}}
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        @if (session('success'))
            <div class="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p class="text-sm text-green-700">{{ session('success') }}</p>
            </div>
        @endif

        @if (session('error'))
            <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p class="text-sm text-red-600">{{ session('error') }}</p>
            </div>
        @endif

        @yield('content')
    </main>
</body>
</html>
