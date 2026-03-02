@extends('layouts.admin')

@section('title', 'ダッシュボード')

@section('content')

<div class="mb-8">
    <h1 class="text-2xl font-bold text-navy">ダッシュボード</h1>
    <p class="text-sm text-navy/50 mt-1">{{ now()->format('Y年n月j日（') }}{{ ['日','月','火','水','木','金','土'][now()->dayOfWeek] }}{{ '）' }}</p>
</div>

{{-- 本日のステータス --}}
<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
    <div class="bg-white rounded-xl p-5 shadow-sm">
        <p class="text-xs text-navy/50 font-bold mb-1">本日チェックイン</p>
        <p class="text-3xl font-bold text-navy">{{ $todayCheckIn->count() }}</p>
    </div>
    <div class="bg-white rounded-xl p-5 shadow-sm">
        <p class="text-xs text-navy/50 font-bold mb-1">本日チェックアウト</p>
        <p class="text-3xl font-bold text-navy">{{ $todayCheckOut->count() }}</p>
    </div>
    <div class="bg-white rounded-xl p-5 shadow-sm">
        <p class="text-xs text-navy/50 font-bold mb-1">今後の予約</p>
        <p class="text-3xl font-bold text-navy">{{ $upcomingReservations->count() }}</p>
    </div>
</div>

{{-- 直近の予約 --}}
<div class="bg-white rounded-xl shadow-sm">
    <div class="px-6 py-4 border-b border-gray-100">
        <h2 class="text-base font-bold text-navy">直近の予約</h2>
    </div>

    @if ($upcomingReservations->isEmpty())
        <div class="px-6 py-12 text-center">
            <p class="text-sm text-navy/40">今後の予約はありません</p>
        </div>
    @else
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-gray-100">
                        <th class="text-left px-6 py-3 text-xs text-navy/50 font-bold">宿泊者名</th>
                        <th class="text-left px-6 py-3 text-xs text-navy/50 font-bold">チェックイン</th>
                        <th class="text-left px-6 py-3 text-xs text-navy/50 font-bold">チェックアウト</th>
                        <th class="text-left px-6 py-3 text-xs text-navy/50 font-bold">人数</th>
                        <th class="text-left px-6 py-3 text-xs text-navy/50 font-bold">ステータス</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach ($upcomingReservations as $reservation)
                        <tr class="border-b border-gray-50 hover:bg-cream/50">
                            <td class="px-6 py-3 font-bold text-navy">{{ $reservation->guest_name }}</td>
                            <td class="px-6 py-3 text-navy/70">{{ $reservation->check_in->format('n/j') }}</td>
                            <td class="px-6 py-3 text-navy/70">{{ $reservation->check_out->format('n/j') }}</td>
                            <td class="px-6 py-3 text-navy/70">{{ $reservation->num_guests }}名</td>
                            <td class="px-6 py-3">
                                @php
                                    $statusColors = [
                                        'pending' => 'bg-yellow-100 text-yellow-700',
                                        'confirmed' => 'bg-green-100 text-green-700',
                                        'cancelled' => 'bg-red-100 text-red-700',
                                        'checked_in' => 'bg-blue-100 text-blue-700',
                                        'completed' => 'bg-gray-100 text-gray-600',
                                    ];
                                    $statusLabels = [
                                        'pending' => '未確定',
                                        'confirmed' => '確定',
                                        'cancelled' => 'キャンセル',
                                        'checked_in' => 'チェックイン済',
                                        'completed' => '完了',
                                    ];
                                @endphp
                                <span class="inline-flex px-2 py-0.5 text-xs font-bold rounded-full {{ $statusColors[$reservation->status] ?? '' }}">
                                    {{ $statusLabels[$reservation->status] ?? $reservation->status }}
                                </span>
                            </td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>
    @endif
</div>

@endsection
