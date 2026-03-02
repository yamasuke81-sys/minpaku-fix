<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理者ログイン — the Terrace 長浜</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
    @vite(['resources/css/app.css'])
</head>
<body class="min-h-screen bg-cream flex items-center justify-center p-4">
    <div class="w-full max-w-md">
        <div class="text-center mb-8">
            <a href="{{ route('top') }}" class="text-2xl font-bold text-navy tracking-wide">the Terrace 長浜</a>
            <p class="text-sm text-navy/50 mt-2">管理者ログイン</p>
        </div>

        <div class="bg-white rounded-2xl shadow-sm p-8">
            @if ($errors->any())
                <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p class="text-sm text-red-600">{{ $errors->first() }}</p>
                </div>
            @endif

            <form method="POST" action="{{ route('login') }}">
                @csrf

                <div class="mb-5">
                    <label for="email" class="block text-sm font-bold text-navy mb-1.5">メールアドレス</label>
                    <input
                        type="email"
                        id="email"
                        name="email"
                        value="{{ old('email') }}"
                        required
                        autofocus
                        class="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy text-sm"
                        placeholder="admin@example.com"
                    >
                </div>

                <div class="mb-5">
                    <label for="password" class="block text-sm font-bold text-navy mb-1.5">パスワード</label>
                    <input
                        type="password"
                        id="password"
                        name="password"
                        required
                        class="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy text-sm"
                    >
                </div>

                <div class="mb-6">
                    <label class="flex items-center gap-2">
                        <input type="checkbox" name="remember" class="rounded border-gray-300 text-navy focus:ring-navy/20">
                        <span class="text-sm text-navy/60">ログイン状態を保持する</span>
                    </label>
                </div>

                <button type="submit" class="w-full py-3 bg-navy text-white font-bold rounded-lg hover:bg-navy-light transition text-sm">
                    ログイン
                </button>
            </form>
        </div>

        <p class="text-center mt-6">
            <a href="{{ route('top') }}" class="text-sm text-navy/40 hover:text-navy/60 transition">← サイトに戻る</a>
        </p>
    </div>
</body>
</html>
