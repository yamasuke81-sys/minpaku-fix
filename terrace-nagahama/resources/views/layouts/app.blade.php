<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="@yield('meta_description', '瀬戸内海を一望できる貸切民泊。最大10名まで宿泊可能。BBQ設備完備。')">
    <title>@yield('title', 'the Terrace 長浜') — 海が見える貸切民泊</title>

    {{-- Google Fonts: Noto Sans JP --}}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">

    @vite(['resources/css/app.css', 'resources/js/app.js'])
    @stack('styles')
</head>
<body class="min-h-screen flex flex-col bg-white text-navy @yield('body_class')">

    {{-- ヘッダー --}}
    <header id="siteHeader" class="fixed top-0 left-0 right-0 z-50 transition-all duration-500 @hasSection('hero_transparent') header--transparent @else bg-white/95 backdrop-blur border-b border-gray-100 @endif">
        <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex items-center justify-between h-16">
                {{-- ロゴ --}}
                <a href="{{ route('top') }}" class="text-xl font-bold tracking-wide transition-colors duration-500 @hasSection('hero_transparent') text-white @else text-navy @endif" id="siteLogo">
                    the Terrace 長浜
                </a>

                {{-- デスクトップナビ --}}
                <div class="hidden md:flex items-center gap-6" id="desktopNav">
                    <a href="{{ route('facility') }}" class="text-sm transition @hasSection('hero_transparent') text-white/80 hover:text-white @else text-navy/70 hover:text-navy @endif">施設紹介</a>
                    <a href="{{ route('pricing') }}" class="text-sm transition @hasSection('hero_transparent') text-white/80 hover:text-white @else text-navy/70 hover:text-navy @endif">料金・予約</a>
                    <a href="{{ route('access') }}" class="text-sm transition @hasSection('hero_transparent') text-white/80 hover:text-white @else text-navy/70 hover:text-navy @endif">アクセス</a>
                    <a href="{{ route('faq') }}" class="text-sm transition @hasSection('hero_transparent') text-white/80 hover:text-white @else text-navy/70 hover:text-navy @endif">FAQ</a>
                    <a href="{{ route('contact') }}" class="text-sm transition @hasSection('hero_transparent') text-white/80 hover:text-white @else text-navy/70 hover:text-navy @endif">お問い合わせ</a>
                    <a href="{{ route('pricing') }}" class="inline-flex items-center px-5 py-2 bg-sunset text-white text-sm font-bold rounded-full hover:bg-sunset-dark transition">
                        予約する
                    </a>
                </div>

                {{-- モバイルメニューボタン --}}
                <button id="mobileMenuBtn" class="md:hidden p-2 transition-colors duration-500 @hasSection('hero_transparent') text-white @else text-navy @endif" aria-label="メニューを開く">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
                    </svg>
                </button>
            </div>

            {{-- モバイルメニュー --}}
            <div id="mobileMenu" class="hidden md:hidden pb-4 border-t border-gray-100/20">
                <div class="flex flex-col gap-3 pt-4">
                    <a href="{{ route('facility') }}" class="text-sm text-navy/70 hover:text-navy px-2 py-1">施設紹介</a>
                    <a href="{{ route('pricing') }}" class="text-sm text-navy/70 hover:text-navy px-2 py-1">料金・予約</a>
                    <a href="{{ route('access') }}" class="text-sm text-navy/70 hover:text-navy px-2 py-1">アクセス</a>
                    <a href="{{ route('faq') }}" class="text-sm text-navy/70 hover:text-navy px-2 py-1">FAQ</a>
                    <a href="{{ route('contact') }}" class="text-sm text-navy/70 hover:text-navy px-2 py-1">お問い合わせ</a>
                    <a href="{{ route('pricing') }}" class="inline-flex items-center justify-center px-5 py-2 bg-sunset text-white text-sm font-bold rounded-full hover:bg-sunset-dark transition mx-2">
                        予約する
                    </a>
                </div>
            </div>
        </nav>
    </header>

    {{-- ヘッダー分のスペーサー（固定ヘッダー対応） --}}
    @unless(View::hasSection('hero_transparent'))
    <div class="h-16"></div>
    @endunless

    {{-- メインコンテンツ --}}
    <main class="flex-1">
        @yield('content')
    </main>

    {{-- フッター --}}
    <footer class="bg-navy text-white">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                {{-- 施設情報 --}}
                <div>
                    <h3 class="text-lg font-bold mb-4">the Terrace 長浜</h3>
                    <p class="text-sm text-white/70 leading-relaxed">
                        瀬戸内海を一望できる貸切民泊。<br>
                        大切な人と、特別な時間を。
                    </p>
                </div>

                {{-- ナビゲーション --}}
                <div>
                    <h3 class="text-sm font-bold mb-4 text-white/50 uppercase tracking-wider">ページ</h3>
                    <ul class="space-y-2">
                        <li><a href="{{ route('facility') }}" class="text-sm text-white/70 hover:text-white transition">施設紹介</a></li>
                        <li><a href="{{ route('pricing') }}" class="text-sm text-white/70 hover:text-white transition">料金・予約</a></li>
                        <li><a href="{{ route('access') }}" class="text-sm text-white/70 hover:text-white transition">アクセス</a></li>
                        <li><a href="{{ route('faq') }}" class="text-sm text-white/70 hover:text-white transition">FAQ</a></li>
                        <li><a href="{{ route('contact') }}" class="text-sm text-white/70 hover:text-white transition">お問い合わせ</a></li>
                    </ul>
                </div>

                {{-- 予約CTA --}}
                <div>
                    <h3 class="text-sm font-bold mb-4 text-white/50 uppercase tracking-wider">ご予約</h3>
                    <p class="text-sm text-white/70 mb-4">空室状況をご確認のうえ、ご予約ください。</p>
                    <a href="{{ route('pricing') }}" class="inline-flex items-center px-6 py-3 bg-sunset text-white text-sm font-bold rounded-full hover:bg-sunset-light transition">
                        空室を確認する
                    </a>
                </div>
            </div>

            <div class="border-t border-white/10 mt-8 pt-8 text-center">
                <p class="text-xs text-white/40">&copy; {{ date('Y') }} the Terrace 長浜. All rights reserved.</p>
            </div>
        </div>
    </footer>

    {{-- モバイルメニュー制御 --}}
    <script>
        document.getElementById('mobileMenuBtn').addEventListener('click', function() {
            const menu = document.getElementById('mobileMenu');
            menu.classList.toggle('hidden');
        });
    </script>
    @stack('scripts')
</body>
</html>
