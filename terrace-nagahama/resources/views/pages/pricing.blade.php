@extends('layouts.app')

@section('title', '料金・ご予約')
@section('meta_description', 'the Terrace 長浜の宿泊料金とご予約案内。人数別料金表、予約方法をご案内します。')

@php
    // ========================================
    // 予約サービスのURL設定
    // ここを差し替えるだけで予約ボタンのリンク先が変わります
    // ========================================
    $bookingServices = [
        [
            'name' => 'Airbnb',
            'url' => '#', // ← Airbnb リスティングURLをここに設定
            'color' => 'bg-[#FF5A5F]',
            'hoverColor' => 'hover:bg-[#E04E52]',
            'icon' => '<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.001 18.5c-1.733 0-3.207-1.093-3.744-2.603-.18-.48-.219-.894-.219-1.236 0-.585.156-1.111.399-1.613.279-.588.69-1.146 1.143-1.694.81-.981 1.821-1.94 2.421-2.717.6.777 1.611 1.736 2.421 2.717.453.548.864 1.106 1.143 1.694.243.502.399 1.028.399 1.613 0 .342-.039.756-.219 1.236-.537 1.51-2.011 2.603-3.744 2.603zm0-12.5c-1.4 1.8-5.4 6.6-5.4 9.6 0 3.1 2.3 5.4 5.4 5.4s5.4-2.3 5.4-5.4c0-3-4-7.8-5.4-9.6z"/></svg>',
            'description' => 'Airbnb で予約',
            'enabled' => false, // URL設定後に true に変更
        ],
        [
            'name' => '楽天トラベル',
            'url' => '#', // ← 楽天トラベル施設ページURLをここに設定
            'color' => 'bg-[#BF0000]',
            'hoverColor' => 'hover:bg-[#A00000]',
            'icon' => '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
            'description' => '楽天トラベルで予約',
            'enabled' => false, // URL設定後に true に変更
        ],
    ];
@endphp

@section('content')

{{-- ページヘッダー --}}
<section class="bg-navy py-16 sm:py-20">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p class="text-sm text-sunset font-bold tracking-wider mb-2">PRICING & RESERVATION</p>
        <h1 class="text-3xl sm:text-4xl font-bold text-white">料金・ご予約</h1>
        <p class="text-white/60 mt-4 max-w-xl mx-auto">
            ご宿泊の料金と、ご予約方法をご案内します。
        </p>
    </div>
</section>

{{-- 基本情報 --}}
<section class="py-12 sm:py-16">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
            <div class="bg-cream rounded-xl p-5 text-center">
                <p class="text-xs text-navy/50 font-bold mb-1">チェックイン</p>
                <p class="text-2xl font-bold text-navy">15:00</p>
            </div>
            <div class="bg-cream rounded-xl p-5 text-center">
                <p class="text-xs text-navy/50 font-bold mb-1">チェックアウト</p>
                <p class="text-2xl font-bold text-navy">10:00</p>
            </div>
            <div class="bg-cream rounded-xl p-5 text-center">
                <p class="text-xs text-navy/50 font-bold mb-1">最大宿泊人数</p>
                <p class="text-2xl font-bold text-navy">10名</p>
            </div>
        </div>

        {{-- 料金表 --}}
        <div class="text-center mb-8">
            <p class="text-sm text-sunset font-bold tracking-wider mb-2">PRICE TABLE</p>
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">宿泊料金</h2>
            <p class="text-sm text-navy/50 mt-2">※ 料金は1泊あたり（税込）</p>
        </div>

        <div class="bg-white rounded-2xl shadow-sm overflow-hidden mb-8">
            <table class="w-full text-sm">
                <thead>
                    <tr class="bg-navy text-white">
                        <th class="text-left px-6 py-3 font-bold">区分</th>
                        <th class="text-right px-6 py-3 font-bold">基本料金</th>
                        <th class="text-right px-6 py-3 font-bold">1名追加ごと</th>
                    </tr>
                </thead>
                <tbody>
                    <tr class="border-b border-gray-100">
                        <td class="px-6 py-4 font-bold text-navy">平日（日〜木）</td>
                        <td class="px-6 py-4 text-right text-navy">¥25,000〜</td>
                        <td class="px-6 py-4 text-right text-navy/60">+¥3,000</td>
                    </tr>
                    <tr class="border-b border-gray-100 bg-cream/50">
                        <td class="px-6 py-4 font-bold text-navy">金曜日</td>
                        <td class="px-6 py-4 text-right text-navy">¥30,000〜</td>
                        <td class="px-6 py-4 text-right text-navy/60">+¥3,500</td>
                    </tr>
                    <tr class="border-b border-gray-100">
                        <td class="px-6 py-4 font-bold text-navy">土曜日</td>
                        <td class="px-6 py-4 text-right text-navy">¥35,000〜</td>
                        <td class="px-6 py-4 text-right text-navy/60">+¥4,000</td>
                    </tr>
                    <tr class="bg-sunset/5">
                        <td class="px-6 py-4 font-bold text-sunset">繁忙期・祝前日</td>
                        <td class="px-6 py-4 text-right text-sunset font-bold">別途設定</td>
                        <td class="px-6 py-4 text-right text-navy/60">—</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="bg-cream rounded-xl p-5 mb-4">
            <h4 class="font-bold text-navy text-sm mb-2">料金に含まれるもの</h4>
            <p class="text-sm text-navy/60">宿泊料 / アメニティ（タオル・シャンプー等） / Wi-Fi / 駐車場（2台まで）</p>
        </div>
        <div class="bg-cream rounded-xl p-5">
            <h4 class="font-bold text-navy text-sm mb-2">オプション（有料）</h4>
            <p class="text-sm text-navy/60">BBQ炭セット / 追加駐車（要相談）</p>
        </div>
    </div>
</section>

{{-- 予約セクション --}}
<section class="py-12 sm:py-16 bg-cream">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-10">
            <p class="text-sm text-sunset font-bold tracking-wider mb-2">RESERVATION</p>
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">ご予約方法</h2>
            <p class="text-sm text-navy/50 mt-3 max-w-lg mx-auto">
                以下の予約サービスからご予約いただけます。<br>
                空室状況・正確な料金は各サービスでご確認ください。
            </p>
        </div>

        {{-- 予約ボタン一覧 --}}
        @php $hasEnabledService = collect($bookingServices)->where('enabled', true)->isNotEmpty(); @endphp

        @if ($hasEnabledService)
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto mb-8">
                @foreach ($bookingServices as $service)
                    @if ($service['enabled'])
                        <a href="{{ $service['url'] }}"
                           target="_blank"
                           rel="noopener noreferrer"
                           class="flex items-center justify-center gap-3 px-6 py-4 {{ $service['color'] }} {{ $service['hoverColor'] }} text-white font-bold rounded-xl transition shadow-sm text-base">
                            {!! $service['icon'] !!}
                            {{ $service['description'] }}
                        </a>
                    @endif
                @endforeach
            </div>
        @else
            {{-- 予約サービス未設定時の表示 --}}
            <div class="bg-white rounded-2xl p-8 sm:p-10 text-center shadow-sm max-w-lg mx-auto mb-8">
                <div class="w-16 h-16 bg-sunset/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg class="w-8 h-8 text-sunset" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                </div>
                <h3 class="text-lg font-bold text-navy mb-2">ご予約受付準備中</h3>
                <p class="text-sm text-navy/60 mb-6">
                    予約サービスを準備中です。<br>
                    お急ぎの方はお問い合わせフォームからご連絡ください。
                </p>
                <a href="{{ route('contact') }}" class="inline-flex items-center justify-center px-8 py-3 bg-sunset text-white font-bold rounded-full hover:bg-sunset-light transition shadow-sm">
                    お問い合わせ
                </a>
            </div>
        @endif

        <p class="text-center text-xs text-navy/40">
            ※ 予約は外部サービスのページで完了します。当サイトではお支払いは発生しません。
        </p>
    </div>
</section>

{{-- キャンセルポリシー --}}
<section class="py-12 sm:py-16">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-8">
            <p class="text-sm text-sunset font-bold tracking-wider mb-2">POLICY</p>
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">キャンセルポリシー</h2>
        </div>

        <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="bg-navy/5">
                        <th class="text-left px-6 py-3 font-bold text-navy">タイミング</th>
                        <th class="text-right px-6 py-3 font-bold text-navy">キャンセル料</th>
                    </tr>
                </thead>
                <tbody>
                    <tr class="border-b border-gray-100">
                        <td class="px-6 py-4 text-navy">7日前まで</td>
                        <td class="px-6 py-4 text-right font-bold text-green-600">無料</td>
                    </tr>
                    <tr class="border-b border-gray-100">
                        <td class="px-6 py-4 text-navy">6日前〜2日前</td>
                        <td class="px-6 py-4 text-right font-bold text-sunset">宿泊料金の50%</td>
                    </tr>
                    <tr>
                        <td class="px-6 py-4 text-navy">前日・当日・無連絡</td>
                        <td class="px-6 py-4 text-right font-bold text-red-600">宿泊料金の100%</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="text-xs text-navy/40 mt-3 text-center">
            ※ 予約サービス経由の場合は、各サービスのキャンセルポリシーが適用される場合があります。
        </p>
    </div>
</section>

{{-- お問い合わせ誘導 --}}
<section class="py-12 sm:py-16 bg-navy">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 class="text-xl sm:text-2xl font-bold text-white mb-3">ご不明な点はお気軽にお問い合わせください</h2>
        <p class="text-white/60 text-sm mb-6">料金、空室状況、設備についてのご質問など、なんでもお気軽にどうぞ。</p>
        <a href="{{ route('contact') }}" class="inline-flex items-center justify-center px-8 py-3 border-2 border-white/30 text-white font-bold rounded-full hover:bg-white/10 transition">
            お問い合わせ
        </a>
    </div>
</section>

@endsection
