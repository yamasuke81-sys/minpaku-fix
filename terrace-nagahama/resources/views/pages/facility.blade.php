@extends('layouts.app')

@section('title', '施設紹介')
@section('meta_description', 'the Terrace 長浜の施設紹介。オーシャンビューのリビング、BBQ設備、間取り・設備一覧をご覧いただけます。')

@section('content')

{{-- ページヘッダー --}}
<section class="bg-navy py-16 sm:py-20">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p class="text-sm text-sunset font-bold tracking-wider mb-2">FACILITY</p>
        <h1 class="text-3xl sm:text-4xl font-bold text-white">施設紹介</h1>
        <p class="text-white/60 mt-4 max-w-xl mx-auto">
            瀬戸内海を一望できるテラス、開放的なリビング、BBQ設備。<br class="hidden sm:inline">
            非日常のリゾート体験をお楽しみください。
        </p>
    </div>
</section>

{{-- 写真ギャラリー --}}
<section class="py-12 sm:py-16">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            {{-- メイン写真（大） --}}
            <div class="col-span-2 row-span-2 aspect-[4/3] rounded-2xl overflow-hidden">
                <img src="{{ asset('images/terrace-hero.jpg') }}" alt="テラスからの瀬戸内海の眺望" class="w-full h-full object-cover">
            </div>
            {{-- サブ写真 --}}
            <div class="aspect-square rounded-2xl overflow-hidden">
                <img src="{{ asset('images/terrace-overview.jpg') }}" alt="テラス俯瞰" class="w-full h-full object-cover">
            </div>
            <div class="aspect-square rounded-2xl overflow-hidden">
                <img src="{{ asset('images/balcony-left.jpg') }}" alt="バルコニーからの眺め" class="w-full h-full object-cover">
            </div>
            <div class="aspect-square rounded-2xl overflow-hidden">
                <img src="{{ asset('images/balcony-right.jpg') }}" alt="バルコニー別アングル" class="w-full h-full object-cover">
            </div>
            <div class="aspect-square bg-sand-light rounded-2xl flex items-center justify-center text-navy/30 text-xs overflow-hidden">
                <span>BBQ設備</span>
            </div>
            <div class="aspect-square bg-sand-light rounded-2xl flex items-center justify-center text-navy/30 text-xs overflow-hidden">
                <span>バスルーム</span>
            </div>
        </div>
        <p class="text-xs text-navy/30 mt-3 text-center">※ 一部の写真は後日追加予定です</p>
    </div>
</section>

{{-- 施設の特徴 --}}
<section class="py-12 sm:py-16 bg-cream">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-12">
            <p class="text-sm text-sunset font-bold tracking-wider mb-2">HIGHLIGHTS</p>
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">施設の特徴</h2>
        </div>

        {{-- 特徴①: テラス --}}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center mb-16">
            <div class="aspect-[16/10] rounded-2xl overflow-hidden">
                <img src="{{ asset('images/terrace-overview.jpg') }}" alt="海を見渡すテラス" class="w-full h-full object-cover">
            </div>
            <div>
                <span class="inline-block px-3 py-1 bg-sunset/10 text-sunset text-xs font-bold rounded-full mb-3">TERRACE</span>
                <h3 class="text-xl sm:text-2xl font-bold text-navy mb-4">海を見渡す、開放感あふれるテラス</h3>
                <p class="text-navy/60 leading-relaxed mb-4">
                    高台に位置する当施設の最大の魅力は、目の前に広がる瀬戸内海のパノラマビュー。
                    テラスに出れば、島々を眺めながらのんびりとした時間を過ごせます。
                    朝は穏やかな海を眺めるコーヒータイム、夕方は美しいサンセットをお楽しみください。
                </p>
                <p class="text-navy/60 leading-relaxed">
                    BBQ設備も完備しているので、海を見ながらの本格BBQも可能です。
                </p>
            </div>
        </div>

        {{-- 特徴②: リビング --}}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center mb-16">
            <div class="order-1 lg:order-2 aspect-[16/10] rounded-2xl overflow-hidden">
                <img src="{{ asset('images/balcony-left.jpg') }}" alt="バルコニーからの眺望" class="w-full h-full object-cover">
            </div>
            <div class="order-2 lg:order-1">
                <span class="inline-block px-3 py-1 bg-sunset/10 text-sunset text-xs font-bold rounded-full mb-3">LIVING</span>
                <h3 class="text-xl sm:text-2xl font-bold text-navy mb-4">広々としたリビングスペース</h3>
                <p class="text-navy/60 leading-relaxed mb-4">
                    大きな窓から海が見えるリビングは、グループ全員がゆったり過ごせる広さ。
                    大画面テレビやボードゲームも揃っているので、仲間との語らいの時間も充実します。
                </p>
                <p class="text-navy/60 leading-relaxed">
                    キッチンも完備しているので、地元の食材を使った料理も楽しめます。
                </p>
            </div>
        </div>

        {{-- 特徴③: BBQ --}}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div class="aspect-[16/10] rounded-2xl overflow-hidden">
                <img src="{{ asset('images/balcony-right.jpg') }}" alt="テラスでのBBQエリア" class="w-full h-full object-cover">
            </div>
            <div>
                <span class="inline-block px-3 py-1 bg-sunset/10 text-sunset text-xs font-bold rounded-full mb-3">BBQ</span>
                <h3 class="text-xl sm:text-2xl font-bold text-navy mb-4">海を見ながらの贅沢BBQ</h3>
                <p class="text-navy/60 leading-relaxed mb-4">
                    テラスに設置されたBBQグリルで、瀬戸内海を眺めながらのBBQは格別。
                    器具は全て揃っていますので、食材だけお持ちいただければOKです。
                </p>
                <p class="text-navy/60 leading-relaxed">
                    近くのスーパーや地元の鮮魚店で新鮮な食材を調達するのもおすすめです。
                </p>
            </div>
        </div>
    </div>
</section>

{{-- 間取り・定員 --}}
<section class="py-12 sm:py-16">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-12">
            <p class="text-sm text-sunset font-bold tracking-wider mb-2">FLOOR PLAN</p>
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">間取り・定員</h2>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            {{-- 間取り図プレースホルダー --}}
            <div class="aspect-square bg-sand-light rounded-2xl flex items-center justify-center text-navy/30 text-sm">
                間取り図（後日配置）
            </div>

            {{-- 部屋情報 --}}
            <div class="space-y-6">
                <div>
                    <h3 class="text-lg font-bold text-navy mb-4">お部屋構成</h3>
                    <div class="space-y-3">
                        <div class="flex items-start gap-3 p-4 bg-cream rounded-xl">
                            <div class="w-10 h-10 bg-navy/5 rounded-lg flex items-center justify-center flex-shrink-0">
                                <svg class="w-5 h-5 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                                </svg>
                            </div>
                            <div>
                                <p class="font-bold text-navy text-sm">リビング・ダイニング</p>
                                <p class="text-xs text-navy/50 mt-1">大きな窓から海を一望。ソファ、テレビ完備</p>
                            </div>
                        </div>
                        <div class="flex items-start gap-3 p-4 bg-cream rounded-xl">
                            <div class="w-10 h-10 bg-navy/5 rounded-lg flex items-center justify-center flex-shrink-0">
                                <svg class="w-5 h-5 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                                </svg>
                            </div>
                            <div>
                                <p class="font-bold text-navy text-sm">寝室① — ベッドルーム</p>
                                <p class="text-xs text-navy/50 mt-1">ダブルベッド × 1</p>
                            </div>
                        </div>
                        <div class="flex items-start gap-3 p-4 bg-cream rounded-xl">
                            <div class="w-10 h-10 bg-navy/5 rounded-lg flex items-center justify-center flex-shrink-0">
                                <svg class="w-5 h-5 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                                </svg>
                            </div>
                            <div>
                                <p class="font-bold text-navy text-sm">寝室② — 和室</p>
                                <p class="text-xs text-navy/50 mt-1">布団 × 数セット（大人数対応）</p>
                            </div>
                        </div>
                        <div class="flex items-start gap-3 p-4 bg-cream rounded-xl">
                            <div class="w-10 h-10 bg-navy/5 rounded-lg flex items-center justify-center flex-shrink-0">
                                <svg class="w-5 h-5 text-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/>
                                </svg>
                            </div>
                            <div>
                                <p class="font-bold text-navy text-sm">テラス</p>
                                <p class="text-xs text-navy/50 mt-1">BBQグリル・テーブル・チェア完備</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="p-5 bg-navy/5 rounded-xl">
                    <h4 class="font-bold text-navy text-sm mb-2">定員</h4>
                    <p class="text-2xl font-bold text-sunset">最大10名</p>
                    <p class="text-xs text-navy/50 mt-1">グループ旅行・ファミリーに最適</p>
                </div>
            </div>
        </div>
    </div>
</section>

{{-- 設備・アメニティ一覧 --}}
<section class="py-12 sm:py-16 bg-cream">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-12">
            <p class="text-sm text-sunset font-bold tracking-wider mb-2">AMENITIES</p>
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">設備・アメニティ</h2>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {{-- キッチン --}}
            <div class="bg-white rounded-xl p-6">
                <h3 class="font-bold text-navy mb-3 flex items-center gap-2">
                    <svg class="w-5 h-5 text-sunset" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                    </svg>
                    キッチン
                </h3>
                <ul class="space-y-1.5 text-sm text-navy/60">
                    <li>・冷蔵庫</li>
                    <li>・電子レンジ</li>
                    <li>・IHコンロ</li>
                    <li>・炊飯器</li>
                    <li>・食器類・調理器具</li>
                </ul>
            </div>

            {{-- バス・トイレ --}}
            <div class="bg-white rounded-xl p-6">
                <h3 class="font-bold text-navy mb-3 flex items-center gap-2">
                    <svg class="w-5 h-5 text-sunset" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"/>
                    </svg>
                    バス・トイレ
                </h3>
                <ul class="space-y-1.5 text-sm text-navy/60">
                    <li>・バスルーム（シャワー付き）</li>
                    <li>・洗面台</li>
                    <li>・トイレ</li>
                    <li>・シャンプー・ボディソープ</li>
                    <li>・タオル</li>
                    <li>・ドライヤー</li>
                </ul>
            </div>

            {{-- リビング --}}
            <div class="bg-white rounded-xl p-6">
                <h3 class="font-bold text-navy mb-3 flex items-center gap-2">
                    <svg class="w-5 h-5 text-sunset" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                    リビング・設備
                </h3>
                <ul class="space-y-1.5 text-sm text-navy/60">
                    <li>・大画面テレビ</li>
                    <li>・エアコン</li>
                    <li>・無料Wi-Fi</li>
                    <li>・ボードゲーム</li>
                    <li>・洗濯機</li>
                </ul>
            </div>

            {{-- BBQ --}}
            <div class="bg-white rounded-xl p-6">
                <h3 class="font-bold text-navy mb-3 flex items-center gap-2">
                    <svg class="w-5 h-5 text-sunset" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/>
                    </svg>
                    BBQ設備
                </h3>
                <ul class="space-y-1.5 text-sm text-navy/60">
                    <li>・BBQグリル</li>
                    <li>・BBQテーブル・チェア</li>
                    <li>・トング・網</li>
                    <li>・炭（有料）</li>
                </ul>
            </div>

            {{-- 駐車場 --}}
            <div class="bg-white rounded-xl p-6">
                <h3 class="font-bold text-navy mb-3 flex items-center gap-2">
                    <svg class="w-5 h-5 text-sunset" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                    </svg>
                    駐車場・その他
                </h3>
                <ul class="space-y-1.5 text-sm text-navy/60">
                    <li>・無料駐車場（2台まで）</li>
                    <li>・物干しスペース</li>
                </ul>
            </div>

            {{-- 注意事項 --}}
            <div class="bg-white rounded-xl p-6 border-2 border-sunset/20">
                <h3 class="font-bold text-navy mb-3 flex items-center gap-2">
                    <svg class="w-5 h-5 text-sunset" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/>
                    </svg>
                    ご注意ください
                </h3>
                <ul class="space-y-1.5 text-sm text-navy/60">
                    <li>・<span class="font-bold text-navy/80">施設へのアクセス道路が狭いです</span></li>
                    <li>・<span class="font-bold text-navy/80">階段が急です</span>（大きな荷物にご注意）</li>
                    <li>・22時以降の騒音はお控えください</li>
                    <li>・室内は禁煙（テラスのみ喫煙可）</li>
                </ul>
            </div>
        </div>
    </div>
</section>

{{-- CTAセクション --}}
<section class="py-16 sm:py-20 bg-navy">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 class="text-2xl sm:text-3xl font-bold text-white mb-4">
            ご予約はこちらから
        </h2>
        <p class="text-white/70 mb-8">空室状況をご確認のうえ、お好みのサービスからご予約ください。</p>
        <a href="{{ route('pricing') }}" class="inline-flex items-center justify-center px-8 py-3 bg-sunset text-white font-bold rounded-full hover:bg-sunset-light transition text-base shadow-lg">
            料金・ご予約ページへ
        </a>
    </div>
</section>

@endsection
