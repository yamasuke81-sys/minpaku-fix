<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Reservation;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /** 管理画面ダッシュボード */
    public function index()
    {
        $upcomingReservations = Reservation::where('status', '!=', 'cancelled')
            ->where('check_in', '>=', now()->toDateString())
            ->orderBy('check_in')
            ->limit(10)
            ->get();

        $todayCheckIn = Reservation::where('check_in', now()->toDateString())
            ->where('status', '!=', 'cancelled')
            ->get();

        $todayCheckOut = Reservation::where('check_out', now()->toDateString())
            ->where('status', '!=', 'cancelled')
            ->get();

        return view('admin.dashboard', compact(
            'upcomingReservations',
            'todayCheckIn',
            'todayCheckOut',
        ));
    }
}
