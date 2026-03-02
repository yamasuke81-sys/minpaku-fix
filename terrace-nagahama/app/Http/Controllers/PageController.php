<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class PageController extends Controller
{
    /** トップページ */
    public function top()
    {
        return view('pages.top');
    }

    /** 施設紹介 */
    public function facility()
    {
        return view('pages.facility');
    }

    /** 料金・予約 */
    public function pricing()
    {
        return view('pages.pricing');
    }

    /** アクセス */
    public function access()
    {
        return view('pages.access');
    }

    /** FAQ */
    public function faq()
    {
        return view('pages.faq');
    }

    /** お問い合わせ */
    public function contact()
    {
        return view('pages.contact');
    }
}
