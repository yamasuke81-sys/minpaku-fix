@extends('layouts.app')

@section('title', 'the Terrace 長浜')
@section('meta_description', '瀬戸内海を一望できる貸切民泊「the Terrace 長浜」。最大10名宿泊可能、BBQ設備完備。広島で非日常のリゾート体験を。')

{{-- レイアウトに透明ヘッダーを指示 --}}
@section('hero_transparent', true)

@push('styles')
<style>
    /* ヒーロー: スクロール中はスクロールバーの「ガタつき」防止 */
    .hero-scroll { overflow-anchor: none; }

    /* 宿名タイトルのアニメーション */
    .hero-title-line {
        display: block;
        opacity: 0;
        transform: translateY(30px);
        transition: opacity 0.8s ease, transform 0.8s ease;
    }
    .hero-title-line.visible {
        opacity: 1;
        transform: translateY(0);
    }
    .hero-title-line:nth-child(2) { transition-delay: 0.2s; }
    .hero-title-line:nth-child(3) { transition-delay: 0.4s; }
    .hero-title-line:nth-child(4) { transition-delay: 0.5s; }

    /* スクロールインジケーター */
    @keyframes scrollPulse {
        0%, 100% { opacity: 0.6; transform: translateY(0); }
        50% { opacity: 1; transform: translateY(8px); }
    }
    .scroll-indicator { animation: scrollPulse 2s ease-in-out infinite; }

    /* ヘッダー透明→白の切り替え */
    .header--transparent {
        background: transparent !important;
        border-bottom-color: transparent !important;
        backdrop-filter: none !important;
    }
    .header--solid {
        background: rgba(255,255,255,0.95) !important;
        border-bottom: 1px solid rgba(0,0,0,0.05) !important;
        backdrop-filter: blur(10px) !important;
    }
</style>
@endpush

@section('content')

{{-- ===== スクロール演出ヒーローセクション ===== --}}
{{-- 外側コンテナ: 250vh の高さでスクロール領域を確保 --}}
<section id="heroScroll" class="relative hero-scroll" style="height: 250vh;">

    {{-- sticky ビューポート: 画面に張り付く --}}
    <div class="sticky top-0 h-screen w-full overflow-hidden">

        {{-- 背景写真（縦長写真: 上=空, 下=テラス） --}}
        <img
            id="heroImg"
            src="{{ asset('images/terrace-hero.jpg') }}"
            alt="the Terrace 長浜 — テラスからの瀬戸内海の眺望"
            class="absolute inset-0 w-full h-full object-cover will-change-transform"
            style="object-position: center 0%;"
        >

        {{-- オーバーレイ（テキスト読みやすさ用、スクロールで変化） --}}
        <div id="heroOverlay" class="absolute inset-0 pointer-events-none" style="background: rgba(27,58,92,0);"></div>

        {{-- 宿名テキスト（スクロールでフェードイン） --}}
        <div id="heroTitle" class="absolute inset-0 flex flex-col items-center justify-center px-4 pointer-events-none" style="opacity: 0;">
            <div class="text-center pointer-events-auto">
                <span class="hero-title-line text-xs sm:text-sm tracking-[0.4em] text-white/70 uppercase mb-6 font-light">
                    Seto Inland Sea Private Villa
                </span>
                <h1 class="hero-title-line text-4xl sm:text-6xl lg:text-7xl font-bold text-white tracking-wider mb-4" style="text-shadow: 0 2px 20px rgba(0,0,0,0.3);">
                    the Terrace 長浜
                </h1>
                <p class="hero-title-line text-sm sm:text-lg text-white/80 mb-10 max-w-lg mx-auto leading-relaxed font-light">
                    瀬戸内の海を、貸し切る贅沢。
                </p>
                <div class="hero-title-line flex flex-col sm:flex-row gap-4 justify-center">
                    <a href="{{ route('pricing') }}" class="inline-flex items-center justify-center px-8 py-3 bg-sunset text-white font-bold rounded-full hover:bg-sunset-light transition text-base shadow-lg">
                        空室を確認・予約する
                    </a>
                    <a href="{{ route('facility') }}" class="inline-flex items-center justify-center px-8 py-3 border-2 border-white/50 text-white font-bold rounded-full hover:bg-white/10 transition text-base">
                        施設を見る
                    </a>
                </div>
            </div>
        </div>

        {{-- スクロールインジケーター（最初だけ表示） --}}
        <div id="scrollHint" class="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 scroll-indicator">
            <span class="text-white/60 text-xs tracking-[0.2em] uppercase">Scroll</span>
            <svg class="w-5 h-5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 14l-7 7m0 0l-7-7"/>
            </svg>
        </div>

    </div>
</section>

{{-- ===== 特徴セクション ===== --}}
<section class="py-16 sm:py-24 bg-cream">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-12 sm:mb-16">
            <p class="text-sm text-sunset font-bold tracking-wider mb-2">FEATURES</p>
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">the Terrace 長浜の魅力</h2>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {{-- 特徴1: オーシャンビュー --}}
            <div class="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition">
                <div class="w-14 h-14 bg-navy/5 rounded-xl flex items-center justify-center mb-4">
                    <svg class="w-7 h-7 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <h3 class="text-lg font-bold text-navy mb-2">オーシャンビュー</h3>
                <p class="text-sm text-navy/60 leading-relaxed">
                    テラスから瀬戸内海を一望。朝焼けから夕日まで、刻々と変わる海の表情をお楽しみいただけます。
                </p>
            </div>

            {{-- 特徴2: 貸切 --}}
            <div class="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition">
                <div class="w-14 h-14 bg-navy/5 rounded-xl flex items-center justify-center mb-4">
                    <svg class="w-7 h-7 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                    </svg>
                </div>
                <h3 class="text-lg font-bold text-navy mb-2">一棟貸切</h3>
                <p class="text-sm text-navy/60 leading-relaxed">
                    最大10名まで宿泊可能。他のゲストを気にせず、グループやファミリーでゆったりお過ごしいただけます。
                </p>
            </div>

            {{-- 特徴3: BBQ --}}
            <div class="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition">
                <div class="w-14 h-14 bg-navy/5 rounded-xl flex items-center justify-center mb-4">
                    <svg class="w-7 h-7 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"/>
                    </svg>
                </div>
                <h3 class="text-lg font-bold text-navy mb-2">BBQ設備完備</h3>
                <p class="text-sm text-navy/60 leading-relaxed">
                    海を眺めながらのBBQは格別。テラスにBBQ設備を完備しているので、手ぶらでお楽しみいただけます。
                </p>
            </div>

            {{-- 特徴4: ロケーション --}}
            <div class="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition">
                <div class="w-14 h-14 bg-navy/5 rounded-xl flex items-center justify-center mb-4">
                    <svg class="w-7 h-7 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                </div>
                <h3 class="text-lg font-bold text-navy mb-2">瀬戸内アクセス</h3>
                <p class="text-sm text-navy/60 leading-relaxed">
                    広島市内から車で約40分。しまなみ海道や宮島への拠点としても最適なロケーションです。
                </p>
            </div>
        </div>
    </div>
</section>

{{-- ===== 施設プレビューセクション ===== --}}
<section class="py-16 sm:py-24">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {{-- 写真エリア --}}
            <div class="grid grid-cols-2 gap-4">
                <div class="col-span-2 aspect-[16/10] rounded-2xl overflow-hidden">
                    <img src="{{ asset('images/terrace-overview.jpg') }}" alt="テラスから望む瀬戸内海のパノラマ" class="w-full h-full object-cover">
                </div>
                <div class="aspect-square rounded-2xl overflow-hidden">
                    <img src="{{ asset('images/balcony-left.jpg') }}" alt="バルコニーからの眺望" class="w-full h-full object-cover">
                </div>
                <div class="aspect-square rounded-2xl overflow-hidden">
                    <img src="{{ asset('images/balcony-right.jpg') }}" alt="バルコニーからの眺望（別アングル）" class="w-full h-full object-cover">
                </div>
            </div>

            {{-- テキストエリア --}}
            <div>
                <p class="text-sm text-sunset font-bold tracking-wider mb-2">ABOUT</p>
                <h2 class="text-2xl sm:text-3xl font-bold text-navy mb-6">
                    海と空に包まれる、<br>静かな非日常。
                </h2>
                <p class="text-navy/60 leading-relaxed mb-6">
                    「the Terrace 長浜」は、瀬戸内海を見下ろす高台に建つ一棟貸切の宿泊施設です。
                    目の前に広がる海と島々の絶景、開放感あふれるテラスでのBBQ、
                    そして静かで穏やかな時間。日常を離れ、大切な人との思い出を
                    つくるのにぴったりの場所です。
                </p>
                <ul class="space-y-3 mb-8">
                    <li class="flex items-center gap-3 text-sm text-navy/70">
                        <span class="w-5 h-5 rounded-full bg-sunset/10 flex items-center justify-center flex-shrink-0">
                            <svg class="w-3 h-3 text-sunset" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                        </span>
                        最大10名まで宿泊可能（グループ・ファミリーに最適）
                    </li>
                    <li class="flex items-center gap-3 text-sm text-navy/70">
                        <span class="w-5 h-5 rounded-full bg-sunset/10 flex items-center justify-center flex-shrink-0">
                            <svg class="w-3 h-3 text-sunset" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                        </span>
                        チェックイン 15:00 / チェックアウト 10:00
                    </li>
                    <li class="flex items-center gap-3 text-sm text-navy/70">
                        <span class="w-5 h-5 rounded-full bg-sunset/10 flex items-center justify-center flex-shrink-0">
                            <svg class="w-3 h-3 text-sunset" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                        </span>
                        BBQ設備・無料Wi-Fi・駐車場完備
                    </li>
                    <li class="flex items-center gap-3 text-sm text-navy/70">
                        <span class="w-5 h-5 rounded-full bg-sunset/10 flex items-center justify-center flex-shrink-0">
                            <svg class="w-3 h-3 text-sunset" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                        </span>
                        無料駐車場あり（2台まで）
                    </li>
                </ul>
                <a href="{{ route('facility') }}" class="inline-flex items-center gap-2 text-sunset font-bold hover:text-sunset-dark transition">
                    施設の詳細を見る
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                    </svg>
                </a>
            </div>
        </div>
    </div>
</section>

{{-- ===== CTAセクション ===== --}}
<section class="py-16 sm:py-24 bg-navy">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p class="text-sm text-sunset font-bold tracking-wider mb-2">RESERVATION</p>
        <h2 class="text-2xl sm:text-3xl font-bold text-white mb-4">
            ご予約はこちらから
        </h2>
        <p class="text-white/70 mb-8 leading-relaxed">
            空室状況をカレンダーでご確認いただけます。<br>
            ご不明な点はお気軽にお問い合わせください。
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="{{ route('pricing') }}" class="inline-flex items-center justify-center px-8 py-3 bg-sunset text-white font-bold rounded-full hover:bg-sunset-light transition text-base shadow-lg">
                空室を確認・予約する
            </a>
            <a href="{{ route('contact') }}" class="inline-flex items-center justify-center px-8 py-3 border-2 border-white/30 text-white font-bold rounded-full hover:bg-white/10 transition text-base">
                お問い合わせ
            </a>
        </div>
    </div>
</section>

@endsection

@push('scripts')
<script>
(function() {
    'use strict';

    // 要素の参照
    var heroScroll = document.getElementById('heroScroll');
    var heroImg    = document.getElementById('heroImg');
    var heroOverlay = document.getElementById('heroOverlay');
    var heroTitle  = document.getElementById('heroTitle');
    var scrollHint = document.getElementById('scrollHint');
    var header     = document.getElementById('siteHeader');
    var logo       = document.getElementById('siteLogo');
    var desktopNav = document.getElementById('desktopNav');
    var mobileBtn  = document.getElementById('mobileMenuBtn');

    if (!heroScroll) return;

    var titleLines = heroTitle.querySelectorAll('.hero-title-line');
    var titleRevealed = false;
    var ticking = false;

    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
    }

    function update() {
        ticking = false;

        var rect = heroScroll.getBoundingClientRect();
        var scrolled = -rect.top;
        var maxScroll = heroScroll.offsetHeight - window.innerHeight;
        // progress: 0（ページ上端）→ 1（ヒーローセクション終端）
        var progress = Math.max(0, Math.min(1, scrolled / maxScroll));

        // === 1. 画像のパン: 上（空）→ 下（テラス）===
        // object-position を 0% → 60% に移動（写真の上部→中央下部）
        var imgPos = progress * 60;
        heroImg.style.objectPosition = 'center ' + imgPos + '%';

        // === 2. オーバーレイ: テラスが見えたら少し暗くして文字を読みやすく ===
        var overlayAlpha = 0;
        if (progress > 0.3) {
            overlayAlpha = Math.min(0.45, (progress - 0.3) * 1.2);
        }
        heroOverlay.style.background = 'rgba(27,58,92,' + overlayAlpha + ')';

        // === 3. タイトル: 40%付近でフェードイン ===
        var titleOpacity = 0;
        if (progress > 0.35) {
            titleOpacity = Math.min(1, (progress - 0.35) * 4);
        }
        heroTitle.style.opacity = titleOpacity;

        // タイトル各行のスタガードアニメーション
        if (progress > 0.38 && !titleRevealed) {
            titleRevealed = true;
            for (var i = 0; i < titleLines.length; i++) {
                titleLines[i].classList.add('visible');
            }
        } else if (progress < 0.3 && titleRevealed) {
            titleRevealed = false;
            for (var i = 0; i < titleLines.length; i++) {
                titleLines[i].classList.remove('visible');
            }
        }

        // === 4. スクロールインジケーター: すぐ消える ===
        var hintOpacity = Math.max(0, 1 - progress * 5);
        scrollHint.style.opacity = hintOpacity;

        // === 5. ヘッダー: 透明→白 ===
        // ヒーローセクションを抜けたら白ヘッダーに
        var pastHero = scrolled > maxScroll - 100;
        if (pastHero) {
            header.classList.remove('header--transparent');
            header.classList.add('header--solid');
            logo.style.color = '';
            logo.classList.remove('text-white');
            logo.classList.add('text-navy');
            if (mobileBtn) {
                mobileBtn.classList.remove('text-white');
                mobileBtn.classList.add('text-navy');
            }
            if (desktopNav) {
                var links = desktopNav.querySelectorAll('a:not(.bg-sunset)');
                for (var i = 0; i < links.length; i++) {
                    links[i].classList.remove('text-white/80', 'hover:text-white');
                    links[i].classList.add('text-navy/70', 'hover:text-navy');
                }
            }
        } else {
            header.classList.add('header--transparent');
            header.classList.remove('header--solid');
            logo.classList.remove('text-navy');
            logo.classList.add('text-white');
            if (mobileBtn) {
                mobileBtn.classList.remove('text-navy');
                mobileBtn.classList.add('text-white');
            }
            if (desktopNav) {
                var links = desktopNav.querySelectorAll('a:not(.bg-sunset)');
                for (var i = 0; i < links.length; i++) {
                    links[i].classList.remove('text-navy/70', 'hover:text-navy');
                    links[i].classList.add('text-white/80', 'hover:text-white');
                }
            }
        }
    }

    // 初期状態を設定
    update();

    // パフォーマンス: passive リスナー
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function() {
        requestAnimationFrame(update);
    }, { passive: true });
})();
</script>
@endpush
