/**
 * Help Center article translations — Georgian (ka) and Turkish (tr).
 */
(function (global) {
  global.CliniflyHelpCenterI18n = {
    ka: {
      "create-clinic-register": {
        title: "კლინიკის შექმნა",
        what: "Register Clinic არის ადგილი, სადაც ქმნით Clinifly-ის ადმინის ანგარიშს და ირჩევთ კლინიკის სახელსა და Clinic Code-ს.",
        why: "ექიმების, პაციენტების ან საჯარო პროფილის დამატებამდე ადმინის ანგარიში გჭირდებათ. რეგისტრაცია უფასოა და რამდენიმე წუთს იღებს.",
        how: [
          "გახსენით Register Clinic და შეიყვანეთ კლინიკის სახელი ისე, როგორც პაციენტებმა უნდა დაინახონ.",
          "აირჩიეთ Clinic Code — მოკლე სიტყვა, რომელსაც თანამშრომლები და პაციენტები დაიმახსოვრებენ (მაგ. MOON ან ELKO). თქვენ თვითონ ქმნით; Clinifly არ გიგზავნით კოდს ელფოსტით.",
          "შეიყვანეთ ელფოსტა და პაროლი (მინ. 6 სიმბოლო), შემდეგ დაადასტურეთ პაროლი.",
          "სურვილისამებრ: დაამატეთ ტელეფონი და მისამართი ახლა, ან შეავსეთ Settings-ში მოგვიანებით.",
          "დააჭირეთ Register Clinic, შემდეგ შედით იმავე ელფოსტით, Clinic Code-ით და პაროლით."
        ],
        tips: [
          "Clinic Code მოკლე დატოვეთ — მხოლოდ ასოები და ციფრები, პრობელები არა.",
          "Invitation Code სურვილისამებრაა — გამოიყენეთ მხოლოდ თუ Clinifly-მ ან პარტნიორმა მოგცათ კამპანიის კოდი."
        ],
        linkLabel: "Register Clinic-ის გახსნა",
      },
      "create-clinic-approval": {
        title: "კლინიკის დამტკიცება როგორ მუშაობს",
        what: "რეგისტრაციის შემდეგ კლინიკის ანგარიში მაშინვე აქტიურია. ზოგიერთ პარტნიორ ან საცდელ პროგრამაში Clinifly-მ შეიძლება დეტალების შემოწმება მოითხოვოს საჯარო დირექტორიაში გამოჩენამდე.",
        why: "ვერიფიკაცია იცავს პაციენტებს და ამყარებს კლინიკების დირექტორიის სანდოობას. პროფილის შევსებისას კლინიკის მოწყობა, ექიმების დამატება და მესიჯინგი მაინც შეგიძლიათ.",
        how: [
          "რეგისტრაციის შემდეგ შედით ადმინის Dashboard-ში.",
          "შეავსეთ Settings (მისამართი, კლინიკის სახელი) და Directory Profile — სრული პროფილი ეხმარება დამტკიცებასა და პაციენტის ნდობას.",
          "თუ Dashboard-ზე გამოჩნდა შეჩერების ან გადახედვის შეტყობინება, დაუკავშირდით Clinifly მხარდაჭერას კლინიკის სახელით და ელფოსტით.",
          "ვერიფიკაციის შემდეგ Directory Profile-ზე ჩართეთ Publish to public directory."
        ],
        tips: [
          "მისამართის არქონება ბლოკავს ლოკაციის ფუნქციებს — ჯერ Settings-ში დაამატეთ."
        ],
        linkLabel: "Dashboard-ის გახსნა",
      },
      "create-clinic-update-info": {
        title: "კლინიკის ინფორმაციის განახლება",
        what: "Settings-ში განაახლებთ კლინიკის სახელს, ლოგოს, მისამართს, სკამების რაოდენობას, რეფერალის ფასდაკლებას და Google Maps ბმულს.",
        why: "სწორი ინფორმაცია ეხმარება პაციენტებს გიპოვონ, აძლიერებს კალენდარს და AI ასისტენტს სწორი დეტალებით ამარაგებს.",
        how: [
          "გვერდით მენიუში გახსენით Settings.",
          "განაახლეთ Clinic Name, Logo URL, Address, Chair count და Google Maps ბმული.",
          "დააყენეთ Referral Discount (%) თუ რეფერალის პროგრამას იყენებთ.",
          "ზედა ნაწილში დააჭირეთ Save Settings — ცვლილებები შენახვამდე არ ინახება."
        ],
        tips: [
          "Chair count განსაზღვრავს, რამდენი ჩანაწერი გამოჩნდება კალენდარში.",
          "ლოგოსთვის გამოიყენეთ პირდაპირი სურათის ბმული — URL ბრაუზერში გახსნით შეამოწმეთ."
        ],
        linkLabel: "Settings-ის გახსნა",
      },
      "doctors-invite": {
        title: "ექიმის მოწვევა",
        what: "ექიმებს Clinic Code-ის გაზიარებით მოიწვევთ. თითოეული ექიმი ჩამოტვირთავს Clinifly მობილურ აპს და რეგისტრირდება Doctor-ად ამ კოდით.",
        why: "დამტკიცებული ექიმები ხედავენ განრიგს, ურთიერთობენ პაციენტებთან და შეიძლება მიენიჭოთ ახალი შეტყობინებების პირველი პასუხის გაცემა.",
        how: [
          "ექიმს უთხარით Clinifly აპის ჩამოტვირთვა App Store-დან (iPhone) ან Google Play-დან (Android).",
          "გაუზიარეთ Clinic Code — იგივე კოდი, რაც რეგისტრაციისას აირჩიეთ.",
          "მოითხოვეთ რეგისტრაცია Doctor-ად (Patient-ად არა) და პროფილის შევსება.",
          "მათი განაცხადი ადმინ პანელში Doctors-ში გამოჩნდება."
        ],
        tips: [
          "Clinic Code კლინიკის პოსტერზე დაწერეთ, რომ თანამშრომელმა სწორი კოდი გამოიყენოს."
        ],
        linkLabel: "Doctors-ის გახსნა",
      },
      "doctors-join": {
        title: "ექიმი როგორ უერთდება კლინიკას",
        what: "ექიმები Clinifly მობილურ აპში რეგისტრირდებიან Clinic Code-ით და Doctor როლით.",
        why: "მობილური აპი ექიმის ყოველდღიური მუშაობისთვისაა — განრიგი, პაციენტთან ჩატი, შემთხვევის განახლებები — კლინიკასთან დაკავშირებით.",
        how: [
          "ექიმი ხსნის Clinifly აპს → Register → ირჩევს Doctor-ს.",
          "შეიყვანის Clinic Code-ს ზუსტად რეგისტრაციისას (ზოგჯერ რეგისტრი მნიშვნელოვანია).",
          "ავსებს სახელს, სპეციალობას და საკონტაქტო მონაცემებს, შემდეგ აგზავნის.",
          "კლინიკის ადმინის დამტკიცებას ელოდება კლინიკის პაციენტებზე წვდომამდე."
        ],
        tips: [
          "თუ ექიმი შეცდომით Patient-ად დარეგისტრირდა, ახალი Doctor ანგარიში უნდა შექმნას."
        ],
        linkLabel: "Doctors-ის გახსნა",
      },
      "doctors-approval": {
        title: "ექიმის დამტკიცების პროცესი",
        what: "ექიმის დამტკიცება — როცა კლინიკის ადმინი ექიმის განაცხადს იღებს და მას კლინიკის მონაცემებზე წვდომა ენიჭება.",
        why: "დამტკიცება იცავს პაციენტების სიას — მხოლოდ ნდობის ღირს ექიმები ხედავენ პაციენტებსა და შეტყობინებებს.",
        how: [
          "ადმინის გვერდით მენიუში გახსენით Doctors.",
          "იპოვეთ Pending განაცხადები.",
          "გადახედეთ ექიმის სახელსა და დეტალებს.",
          "დააჭირეთ Approve.",
          "დამტკიცების შემდეგ Lead inbox-ში მიანიჭეთ ექიმი, რომ პაციენტის შეტყობინებები მას მივიდეს."
        ],
        tips: [
          "დამტკიცებამდე ექიმი პაციენტებს ვერ ხედავს — ამ ნაბიჯს არ დაუვიწყდეთ."
        ],
        linkLabel: "ექიმების დამტკიცება",
      },
      "doctors-roles": {
        title: "ექიმის როლები და უფლებები",
        what: "კლინიკის ადმინი აკონტროლებს კლინიკის ანგარიშს. დამტკიცებული ექიმები იყენებენ მობილურ აპს. Lead inbox განსაზღვრავს, ვინ არის პირველი პასუხის გამცემი.",
        why: "მკაფიო როლები ართმევს დაბნეულობას — პაციენტებს ეცოდინებათ ვისთან საუბრობენ, გუნდს — ვინ უნდა უპასუხოს პირველად.",
        how: [
          "კლინიკის ადმინი: სრული წვდომა Settings-ზე, ფასებზე, Directory Profile-ზე და ექიმის დამტკიცებაზე.",
          "Doctor (მობილური აპი): განრიგი, პაციენტთან ჩატი, მკურნალობა — ადმინის დამტკიცების შემდეგ.",
          "Lead inbox: პაციენტის საუბარზე პირველი ექიმის მინიჭება.",
          "AI Communication (Settings): აირჩიეთ AI, ადამიანი თუ ორივე პასუხობს WhatsApp-სა და Messenger-ზე."
        ],
        tips: [
          "ჯერ ექიმი დაამტკიცეთ, შემდეგ Lead inbox-ში მიანიჭეთ — რიგი მნიშვნელოვანია."
        ],
        linkLabel: "Lead Inbox-ის გახსნა",
      },
      "patients-join": {
        title: "პაციენტები როგორ უერთდებიან კლინიკას",
        what: "პაციენტები Clinifly აპის ჩამოტვირთვით, Clinic Code-ის შეყვანით ან მოწვევის ბმულით/QR კოდით უერთდებიან.",
        why: "დაკავშირებული პაციენტები აგზავნიან მკურნალობის მოთხოვნებს, ფოტოებს, ურთიერთობენ გუნდთან და Clinifly-ით ჯავშანსაც აკეთებენ.",
        how: [
          "პაციენტი ჩამოტვირთავს Clinifly აპს და ირჩევს Patient რეგისტრაციას.",
          "შეიყვანის Clinic Code-ს, ან QR-ს დაასკანერებს / მოწვევის ბმულს გახსნის.",
          "ავსებს პროფილს და აგზავნის შეერთების მოთხოვნას.",
          "მოთხოვნას Patients-ში Pending სტატუსით დაინახავთ."
        ],
        tips: [
          "მოწვევის ბმული და QR (Invite Patients მენიუ) პაციენტებისთვის კოდის აკრეფაზე მარტივია."
        ],
        linkLabel: "Patients-ის გახსნა",
      },
      "patients-approval": {
        title: "პაციენტის დამტკიცება",
        what: "პაციენტის დამტკიცება — როცა იღებთ პაციენტის მოთხოვნას კლინიკაში შესაერთებლად.",
        why: "თქვენ განსაზღვრავთ, ვინ არის პაციენტების სიაში. მხოლოდ დამტკიცებული (აქტიური) პაციენტები ითვლება გეგმის ლიმიტში და შეუძლიათ კლინიკასთან მესიჯი.",
        how: [
          "ადმინის გვერდით მენიუში გახსენით Patients.",
          "იპოვეთ Pending პაციენტები.",
          "გადახედეთ პაციენტის სახელსა და დეტალებს.",
          "დააჭირეთ Approve აქტივაციისთვის.",
          "უარყოფილი ან Pending პაციენტებს კლინიკის ფუნქციები სრულად არ აქვთ."
        ],
        tips: [
          "საერთაშორისო პაციენტებს სწრაფად დაამტკიცეთ — ხშირად შეერთებისთანავე წერენ."
        ],
        linkLabel: "Patients-ის გახსნა",
      },
      "patients-invite": {
        title: "პაციენტების მოწვევა",
        what: "Invite Patients გაძლევთ გასაზიარებელ ბმულსა და QR კოდს — პაციენტები Clinic Code-ის აკრეფის გარეშე უერთდებიან.",
        why: "ბმულის ან QR-ის გაზიარება WhatsApp-ზე, Instagram-ზე ან რეცეფციაზე პაციენტების სიის ყველაზე სწრაფი გზაა.",
        how: [
          "გახსენით Patients → Invite Patients გვერდით მენიუში.",
          "დააკოპირეთ მოწვევის ბმული ან ჩამოტვირთეთ/დაბეჭდეთ QR კოდი.",
          "გაუზიარეთ WhatsApp-ზე, ელფოსტით, სოც. ქსელებში ან რეცეფციაზე.",
          "ბმულის გახსნისას პაციენტი პირდაპირ თქვენს კლინიკაში შეერთებისთვის მიმართავს.",
          "მოთხოვნის გამოჩენისას Patients-ში დაამტკიცეთ."
        ],
        tips: [
          "მოწვევის ბმული Instagram bio-ში და ვებ-გვერდზე დაამატეთ."
        ],
        linkLabel: "Invite Patients-ის გახსნა",
      },
      "patients-connect-doctors": {
        title: "პაციენტის ექიმთან დაკავშირება",
        what: "პაციენტის შეერთების შემდეგ Lead inbox-ში პირველი პასუხის გამცემის მინიჭებით უკავშირდებით ექიმს.",
        why: "პაციენტები სახელოვან ექიმს ან კოორდინატორს ელიან. მინიჭება უზრუნველყოფს, რომ შეტყობინება სწორ ადამიანს მივიდეს და ექიმის აპში გამოჩნდეს.",
        how: [
          "Patients-ში დაამტკიცეთ პაციენტი.",
          "Doctors-ში დაამტკიცეთ მინიმუმ ერთი ექიმი.",
          "Lead inbox → Needs assignment.",
          "აირჩიეთ პაციენტის საუბარი და მიანიჭეთ ექიმი primary responder-ად.",
          "ექიმი პაციენტს მობილურ აპში ხედავს; AI Settings-ის მიხედვით დაეხმარება."
        ],
        tips: [
          "Lead inbox-ის პარამეტრებში ჩართეთ ავტომატური მიმართვა, თუ რამდენიმე ექიმი გაქვთ."
        ],
        linkLabel: "Lead Inbox-ის გახსნა",
      },
      "profile-logo": {
        title: "კლინიკის ლოგოს დამატება",
        what: "კლინიკის ლოგო — მთავარი სურათი, რომელსაც პაციენტები Clinifly აპში კლინიკების ნახვისას ხედავენ.",
        why: "პროფესიონალური ლოგო მაშინვე ამყარებს ნდობას. Directory Profile-ში ლოგო საჯარო სიაში გამოქვეყნებამდე აუცილებელია.",
        how: [
          "ადმინ მენიუში გახსენით Directory Profile.",
          "Clinic Info-ში ატვირთეთ ან ჩასვით ლოგოს URL.",
          "გამოიყენეთ ორმხრივი ან განიერი ლოგო სუფთა ფონზე.",
          "შეინახეთ პროფილი და შეამოწმეთ Profile completion — ლოგო completed უნდა იყოს."
        ],
        tips: [
          "ლოგოს URL Settings-შიც შეგიძლიათ დააყენოთ; Directory Profile ხილულია ძებნაში."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "profile-description": {
        title: "კლინიკის აღწერის დაწერა",
        what: "აღწერა უთხრის საერთაშორისო პაციენტებს, რა განსაკუთრებულია თქვენს კლინიკაში — მკურნალობები, გამოცდილება, ლოკაცია.",
        why: "პაციენტები რამდენიმე კლინიკას ადარებენ წერამდე. გასაგები, მეგობრული აღწერა ზრდის მოთხოვნებს.",
        how: [
          "Directory Profile → Clinic Info.",
          "დაწერეთ 2–4 მოკლე პარაგრაფი კლინიკის, ძირითადი მკურნალობებისა და უპირატესობების შესახებ.",
          "შეიტანეთ ენები და ტიპური ქვეყნები, თუ რელევანტურია.",
          "შეინახეთ და Profile completion-ში აღწერა გამოჩნდეს."
        ],
        tips: [
          "პაციენტებისთვის დაწერეთ, არა სტომატოლოგებისთვის — ფოკუსი შედეგებსა და კომფორტზე."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "profile-photos": {
        title: "კლინიკის ფოტოების დამატება",
        what: "ფოტოები აჩვენებს ინტერიერს, გუნდს და აღჭურვილობას დირექტორიაში დათვალიერებისას.",
        why: "ფოტოები ვიზიტის შემდეგი საუკეთესო რამეა. ფოტოიან კლინიკებს საერთაშორისო პაციენტებისგან მეტი შეტყობინება მოდის.",
        how: [
          "Directory Profile → Media gallery.",
          "დაამატეთ URL-ები რეცეფციის, მკურნალობის ოთახებისა და გუნდის (ნებართვით).",
          "გამოიყენეთ ნათელი, პატიური ფოტოები — ძლიერი ფილტრები არა.",
          "შეინახეთ; ფოტოები completion ქულაში ითვლება."
        ],
        tips: [
          "3–5 კარგი ფოტო უკვე დიდ განსხვავებას ქმნის."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "profile-specialties": {
        title: "სპეციალობების არჩევა",
        what: "Specialties — კლინიკის მიერ შემოთავაზებული მკურნალობები: იმპლანტები, ვინირები, ორთოდონტია და სხვა.",
        why: "პაციენტები სპეციალობით ეძებენ და ფილტრავენ. სპეციალობის არქონება ძებნაში არ გამოჩნდებით.",
        how: [
          "Directory Profile → Specialties.",
          "აირჩიეთ ყველა მკურნალობა, რომელსაც რეალურად სთავაზობთ.",
          "Specialties-ს Settings-ის Treatment Price List-თან შეაერთეთ AI პასუხებისთვის.",
          "შეინახეთ — გამოსაქვეყნებლად მინ. ერთი სპეციალობა საჭიროა."
        ],
        tips: [
          "არ დაამატოთ მკურნალობები, რომლებსაც აღარ სთავაზობთ — განაახლეთ პროფილი და ფასების სია."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "profile-languages": {
        title: "ენების ჩამოთვლა",
        what: "Languages აჩვენებს, რა ენებზე შეუძლიათ გუნდს საუბარი.",
        why: "საერთაშორისო პაციენტები ენით ფილტრავენ. English, Arabic, Russian და სხვა სწორ პაციენტებს მოგიყვანთ.",
        how: [
          "Directory Profile → Languages.",
          "აირჩიეთ ყველა ენა, რომელზეც რეცეფცია და ექიმები საუბრობენ.",
          "შეინახეთ — გამოსაქვეყნებლად მინ. ერთი ენა საჭიროა.",
          "AI ასისტენტიც შეიძლება რამდენიმე ენაზე უპასუხოს, თუ კონფიგურირებულია."
        ],
        tips: [
          "მხოლოდ ის ენები ჩამოთვალეთ, რომელზეც გუნდი ცოცხლად საუბრობს — მხოლოდ AI თარგმანი არა."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "profile-doctors": {
        title: "ექიმების ჩვენება პროფილზე",
        what: "საჯარო პროფილზე ექიმების ჩამოთვლა აჩვენებს, ვინ მკურნალობს პაციენტს.",
        why: "სახელოვანი ექიმები ფოტოებითა და სპეციალობებით ამყარებენ ნდობას, განსაკუთრებით კოსმეტიკურ და ქირურგიულ მკურნალობაზე უცხოურად.",
        how: [
          "ჯერ Doctors-ში დაამტკიცეთ ექიმები.",
          "Directory Profile → Doctors section.",
          "აირჩიეთ, რომელი დამტკიცებული ექიმები გამოჩნდეს საჯარო სიაში.",
          "დარწმუნდით, რომ თითოეულს მობილურ აპში სრული პროფილი აქვს.",
          "Profile completion მაღალი როცა იქნება, შეინახეთ და გამოაქვეყნეთ."
        ],
        tips: [
          "Publish to public directory ჩართეთ მხოლოდ ლოგო, აღწერა, სპეციალობა და ენა როცა სრულია."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "google-find-profile": {
        title: "Google Business პროფილის პოვნა",
        what: "Google Business Profile — Google Maps-სა და Search-ში გვერდი, სადაც პაციენტები რევიუს ტოვებენ.",
        why: "საერთაშორისო პაციენტები ხშირად Google რევიუს ამოწმებენ Clinifly-ზე წერამდე. რეიტინგის ჩვენება Clinifly-ზე მაშინვე ამყარებს ნდობას.",
        how: [
          "Google Maps-ზე მოძებნეთ კლინიკის სახელი.",
          "გახსენით კლინიკის ჩანაწერი — ეს არის Google Business Profile.",
          "თუ არ გაქვთ, შექმენით business.google.com-ზე კლინიკის მისამართით.",
          "დარწმუნდით, რომ პროფილს მართავთ (verified owner ან manager)."
        ],
        tips: [
          "კმაყოფილ პაციენტებს Google რევიუს დატოვება მოთხოვეთ — Google-საც და Clinifly პროფილსაც ეხმარება."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "google-copy-maps-link": {
        title: "Google Maps ბმულის კოპირება",
        what: "Google Maps ბმული — კლინიკის ვებ მისამართი Google-ზე; პაციენტები მარშრუტსა და რევიუს ამით იყენებენ.",
        why: "Clinifly ამ ბმულს იყენებს, რომ პაციენტებმა Google-ზე კლინიკა დაადასტურონ წერამდე.",
        how: [
          "Google Maps-ზე იპოვეთ კლინიკა.",
          "დააჭირეთ Share (ან share ხატულას).",
          "დააკოპირეთ ბმული — ხშირად https://maps.app.goo.gl/… ან https://g.page/…",
          "ბრაუზერში შეამოწმეთ — Google Maps-ზე კლინიკა უნდა გაიხსნას."
        ],
        tips: [
          "Google Maps-ის მოკლე share ბმული გამოიყენეთ, არა ძებნის შემთხვევითი URL."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "google-add-to-clinifly": {
        title: "რევიუს ინფორმაციის Clinifly-ში დამატება",
        what: "Google რევიუს ინფორმაციის Clinifly-ში დამატება აჩვენებს ვარსკვლავების რეიტინგსა და რევიუს რაოდენობას საჯარო პროფილზე.",
        why: "უცხოურად კლინიკების შედარებისას პაციენტები რევიუს ქულაზე ეყრდნობიან. Clinifly-ზე ჩვენება შეიძლება გადაწყვეტილების მიზეზი იყოს.",
        how: [
          "Directory Profile → Reputation & Trust.",
          "Google Business URL ველში ჩასვით Google Business URL.",
          "შეიყვანეთ Google Rating (0–5) და Google Review Count Google პროფილიდან.",
          "შეინახეთ პროფილი.",
          "ახალი რევიუს მიღებისას რიცხვები რამდენიმე თვეში ერთხელ განაახლეთ."
        ],
        tips: [
          "შეიყვანეთ პატიური, აქტუალური რიცხვები — პაციენტებმა Google-ზე შეიძლება შეამოწმონ."
        ],
        linkLabel: "Reputation Section-ის გახსნა",
      },
      "social-website": {
        title: "ვებ-გვერდის დამატება",
        what: "Directory Profile-ზე ვებ-გვერდის ბმული პაციენტებს შეტყობინებამდე კლინიკის საიტზე შესვლის საშუალებას აძლევს.",
        why: "ვებ-გვერდი (ან ლენდინგი) ადასტურებს, რომ რეალური კლინიკა ხართ. სოციალური ბმულების არქონებისას გამოსაქვეყნებლად აუცილებელია.",
        how: [
          "Directory Profile → Social & Web.",
          "ჩასვით სრული ვებ-გვერდის URL https://-ით.",
          "შეამოწმეთ, რომ ბმული სწორად იხსნება.",
          "შეინახეთ პროფილი."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "social-instagram": {
        title: "Instagram-ის დამატება",
        what: "Instagram ბმული პაციენტებს ხედავს before/after ფოტოებსა და კლინიკის ყოველდღიურ ცხოვრებას.",
        why: "კოსმეტიკური და სტომატოლოგიური ტურიზმის პაციენტები ხშირად Instagram-ზე აღმოაჩენენ კლინიკებს. ბმული აპში ნდობას ამყარებს.",
        how: [
          "დააკოპირეთ Instagram პროფილის URL (instagram.com/yourclinic).",
          "ჩასვით Directory Profile → Social & Web → Instagram.",
          "შეინახეთ პროფილი."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "social-facebook": {
        title: "Facebook-ის დამატება",
        what: "Facebook Page ბმული აკავშირებს საჯარო კლინიკის პრეზენციას და მუშაობს Messenger ინტეგრაციასთან.",
        why: "ბევრი პაციენტი Facebook-ზე წერს კლინიკებს. Page ბმული ეხმარება დადასტურებას და Clinifly Messenger-ის დაყენებას.",
        how: [
          "დააკოპირეთ Facebook Page URL (facebook.com/yourpage).",
          "ჩასვით Directory Profile → Social & Web → Facebook.",
          "Facebook შეტყობინებების Clinifly-ში მისაღებად Settings-ში Messenger-იც დააკავშირეთ.",
          "შეინახეთ პროფილი."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "social-tiktok": {
        title: "TikTok-ის დამატება",
        what: "TikTok აჩვენებს მოკლე ვიდეოებს კლინიკის, გუნდისა და პაციენტის ისტორიების შესახებ.",
        why: "ახალგაზრდა საერთაშორისო პაციენტები ხშირად TikTok-ზე პოულობენ კლინიკებს. დამატება ადასტურებს, რომ კლინიკა აქტიური და თანამედროვეა.",
        how: [
          "დააკოპირეთ TikTok პროფილის URL.",
          "ჩასვით Directory Profile → Social & Web → TikTok.",
          "შეინახეთ პროფილი."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "social-youtube": {
        title: "YouTube-ის დამატება",
        what: "YouTube უფრო გრძელ ვიდეოებს უმზადებს — კლინიკის ტური, ექიმის გაცნობა, მკურნალობის ახსნა.",
        why: "ვიდეო ღრმა ნდობას ამყარებს უცხოურად მკურნალობისთვის მომზადებული პაციენტებისთვის.",
        how: [
          "დააკოპირეთ YouTube არხის ან კლინიკის ვიდეო გვერდის URL.",
          "ჩასვით Directory Profile → Social & Web → YouTube.",
          "შეინახეთ პროფილი."
        ],
        tips: [
          "Clinifly-ს ადმინის დაყენების სახელმძღვანელო ვიდეოებიც არის https://www.youtube.com/@Clinifly-ზე."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "social-linkedin": {
        title: "LinkedIn-ის დამატება",
        what: "LinkedIn აჩვენებს კლინიკის პროფესიონალურ და კორპორატიულ პრეზენციას.",
        why: "სასარგებლოა კლინიკებისთვის, რომლებიც ემიგრანტ პროფესიონალებსა და კორპორატიულ სტომატოლოგიურ გეგმებს ემიზნება.",
        how: [
          "დააკოპირეთ კლინიკის LinkedIn კომპანიის გვერდის URL.",
          "ჩასვით Directory Profile → Social & Web → LinkedIn.",
          "შეინახეთ პროფილი."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "ai-enable": {
        title: "AI-ის ჩართვა",
        what: "AI-ის ჩართვა ნიშნავს ავტომატური პასუხების გააქტიურებას და AI-ის სწავლებას კლინიკის ინფორმაციით, ფასებითა და ტონით.",
        why: "საერთაშორისო პაციენტები ხშირად სამუშაო საათების გარეთ წერენ. AI წამებში პასუხობს, პასუხობს ხშირ კითხვებს და აგროვებს ფოტოებს, სანამ გუნდი დაისვენებს.",
        how: [
          "Settings → გახსენით AI Training Center — ისწავლეთ პოლიტიკები, ტონი და რა უნდა იცოდეს AI-მ.",
          "Settings → Treatment Price List — შეიყვანეთ ფასები (AI ამ სიიდან ციტირებს).",
          "Settings → AI Communication — აირჩიეთ Instant AI replies (დასაწყისისთვის რეკომენდებული).",
          "Communication Channels-ში დააკავშირეთ WhatsApp და/ან Messenger.",
          "დააყენეთ კლინიკის საათები და timezone, რომ AI რეალისტურ ჯავშნის დროს შესთავაზოს."
        ],
        tips: [
          "AI სწავლება კლინიკის ინფორმაციისა და ფასების შენახვის შემდეგ — წინააღმდეგ შემთხვევაში პასუხები ზოგადი იქნება."
        ],
        linkLabel: "Settings-ის გახსნა",
      },
      "ai-answers": {
        title: "როგორ პასუხობს AI პაციენტებს",
        what: "AI პასუხობს პაციენტებს Treatment Price List-ით, AI Training Center-ის შიგთავსით, Directory Profile-ითა და კლინიკის საათებით.",
        why: "სწრაფი, თანმიმდევრული პასუხები ამცირებს დაკარგულ ლიდებს. პაციენტები იღებენ ფასის დიაპაზონს, მკურნალობის ინფორმაციასა და შემდეგ ნაბიჯებს საათების ლოდინის გარეშე.",
        how: [
          "ფასები მოდის Settings → Treatment Price List-დან (იმპლანტის ბრენდებისთვის გამოიყენეთ Variants).",
          "პოლიტიკები და ტონი მოდის AI Training Center-დან.",
          "საათები და ჯავშნის წესები მოდის Settings → AI Communication-დან.",
          "AI საუბრებს Lead inbox-სა და Coordination Center-ში გადახედეთ და სწავლება გააუმჯობესეთ."
        ],
        tips: [
          "იმპლანტის ბრენდის ფასები AI სახელების ქვეშ არ ჩაწეროთ — Variants გამოიყენეთ."
        ],
        linkLabel: "AI Training Center-ის გახსნა",
      },
      "ai-whatsapp": {
        title: "WhatsApp ინტეგრაცია",
        what: "WhatsApp ინტეგრაცია აკავშირებს კლინიკის WhatsApp Business ნომერს — პაციენტის ჩატები Clinifly-ში ჩანს და AI-ს შეუძლია პასუხი.",
        why: "WhatsApp საერთაშორისო სტომატოლოგიური პაციენტებისთვის #1 არხია. დაკავშირება ყველა შეტყობინებას ერთ inbox-ში აგროვებს.",
        how: [
          "Settings → Communication Channels → WhatsApp (ან გვერდით მენიუდან WhatsApp).",
          "დააჭირეთ Connect with Meta და შედით Meta Business ანგარიშით.",
          "აირჩიეთ WhatsApp Business ნომერი — ნომერი თქვენი რჩება.",
          "გაგზავნეთ სატესტო შეტყობინება, დააკონფიგურირეთ AI, შემდეგ WhatsApp ON ჩართეთ."
        ],
        tips: [
          "WhatsApp-ზე გასვლამდე Treatment Price List და AI Training დაასრულეთ."
        ],
        linkLabel: "WhatsApp Setup-ის გახსნა",
      },
      "ai-messenger": {
        title: "Messenger ინტეგრაცია",
        what: "Messenger ინტეგრაცია აკავშირებს კლინიკის Facebook Page-ს — Facebook-დან ჩატები Clinifly-ში ჩანს.",
        why: "ბევრი პაციენტი Facebook Messenger-ს ანიჭებს უპირატესობას. WhatsApp, Messenger და აპის შეტყობინებების ერთ inbox ზოგავს გუნდის დროს.",
        how: [
          "Settings → Communication Channels → Messenger.",
          "დააჭირეთ Connect Facebook — გამოიყენეთ ანგარიში, რომელიც კლინიკის Page-ს მართავს.",
          "დაკავშირების შემდეგ AI რეჟიმი დააყენეთ კლინიკის AI-ზე (არა Clinifly Sales AI-ზე).",
          "თუ შეტყობინებები არ მოდის, Messenger diagnostics გაუშვით."
        ],
        tips: [
          "გამოიყენეთ Facebook ანგარიში Meta Business Suite-ში Admin წვდომით კლინიკის Page-ზე."
        ],
        linkLabel: "Messenger Setup-ის გახსნა",
      },
      "ai-human-takeover": {
        title: "ადამიანის ჩართვა",
        what: "Human takeover საშუალებას გაძლევთ გუნდმა ხელით უპასუხოს, სანამ AI პირველ პასუხებს აძლევს, ან AI სრულად შეაჩეროთ მგრძნობიარე საუბრებში.",
        why: "ზოგიერთ შემთხვევაში ნამდვილი ექიმი სჭირდება — რთული სამედიცინო კითხვები, უკმაყოფილო პაციენტები ან საბოლოო მკურნალობის გადაწყვეტილება.",
        how: [
          "Settings → AI Communication → აირჩიეთ Wait for human before AI თუ გუნდი პირველად უნდა უპასუხოს.",
          "Instant რეჟიმი: AI წამებში პასუხობს; გუნდი Lead inbox-იდან ან Chat-იდან ნებისმიერ დროს ჩაერთვება.",
          "Human-only რეჟიმი: AI ავტოპასუხს სრულად თიშავს.",
          "ექიმები მობილური აპიდან პასუხობენ; ადმინები ვებ Chat გვერდიდან."
        ],
        tips: [
          "დაიწყეთ Instant AI + Lead inbox-ის ყოველდღიური მონიტორინგი, სანამ პასუხებს ენდობით."
        ],
        linkLabel: "AI Communication-ის გახსნა",
      },
      "intl-find-clinics": {
        title: "საერთაშორისო პაციენტები როგორ პოულობენ კლინიკებს",
        what: "საერთაშორისო პაციენტები Clinifly პაციენტის აპში კლინიკების დირექტორიას უთვალთვალებენ — ქვეყნით, სპეციალობითა და ენით ფილტრაციით.",
        why: "სრული, გამოქვეყნებული Directory Profile არის გზა, რომლითაც უცხოურად გიპოვონ. არასრული პროფილები იშვიათად იღებენ შეტყობინებას.",
        how: [
          "Directory Profile 100%-მდე შეავსეთ — ლოგო, აღწერა, სპეციალობები, ენები, ფოტოები, რევიუები.",
          "ჩართეთ Publish to public directory.",
          "დაამატეთ Google რევიუები და სოციალური ბმულები ნდობისთვის.",
          "Treatment Price List განაახლეთ, რომ AI ციტირებას შეძლოს პაციენტის წერისას."
        ],
        tips: [
          "Directory Profile წარმოიდგინეთ როგორც თქვენი ვიტრინა საერთაშორისო პაციენტებისთვის."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "intl-multilingual": {
        title: "როგორ მუშაობს მრავალენოვანი კომუნიკაცია",
        what: "მრავალენოვანი კომუნიკაცია ნიშნავს, რომ პაციენტი წერს თავის ენაზე და თქვენი AI ან გუნდი პასუხობს მისთვის გასაგებ ენაზე.",
        why: "სტომატოლოგიური ტურიზმის პაციენტები იშვიათად ფლობენ ადგილობრივ ენას. მრავალენოვანი პასუხები მნიშვნელოვნად ზრდის კონვერსიას.",
        how: [
          "Directory Profile-ზე ჩამოთვალეთ საუბრის ენები.",
          "AI Training Center-ში ისწავლეთ ძირითადი ფრაზები ენებზე, რომლებსაც ემსახურებით.",
          "შესაძლებელია ექიმის ან კოორდინატორის მინიჭება, ვინც პაციენტის ენაზე საუბრობს.",
          "AI იყენებს თქვენს სწავლებასა და ფასების სიას პაციენტის ენის მიუხედავად."
        ],
        tips: [
          "რთული სამედიცინო შემთხვევებში AI პასუხები ყოველთვის ადამიანმა გადაამოწმოს — ნებისმიერ ენაზე."
        ],
        linkLabel: "AI Training Center-ის გახსნა",
      },
      "intl-photos-requests": {
        title: "როგორ აგზავნიან პაციენტები ფოტოებსა და მკურნალობის მოთხოვნებს",
        what: "პაციენტები პირსის ფოტოებსა და მკურნალობის მოთხოვნებს აგზავნიან აპით, WhatsApp-ით ან Messenger-ით. ეს Lead inbox-ში ჩანს.",
        why: "დისტანციური კონსულტაცია ფოტოებით იწყება. სწრაფი გადახედვა და პასუხი იგებს საერთაშორისო შემთხვევებს.",
        how: [
          "პაციენტი ფოტოებს აგზავნის აპის ჩატით, WhatsApp-ით ან Messenger-ით.",
          "Lead inbox ან Coordination Center-ში იხილავთ ახალ მოთხოვნებს.",
          "ექიმი მიანიჭეთ ფოტოების გადასახედად და მკურნალობის გეგმით/ფასით პასუხისთვის.",
          "ადმინში Files გამოიყენეთ პაციენტის გაზიარებული დოკუმენტებისთვის."
        ],
        tips: [
          "24 საათში უპასუხეთ — საერთაშორისო პაციენტები ერთდროულად რამდენიმე კლინიკას წერენ."
        ],
        linkLabel: "Lead Inbox-ის გახსნა",
      },
      "referral-how": {
        title: "რეფერალები როგორ მუშაობს",
        what: "რეფერალის სისტემა აჯილდოვებს არსებულ პაციენტებს, ვინც მეგობრებს კლინიკაში მოიწვევს, მკურნალობაზე ფასდაკლებით.",
        why: "კმაყოფილი პაციენტები საუკეთესო მარკეტერები ხართ. რეფერალები ხარისხიან ლიდებს მოაქვს რეკლამაზე ნაკლები ხარჯით.",
        how: [
          "Settings → დააყენეთ Referral Discount (%) — რეფერერი და ახალი პაციენტი ორივე იღებენ ამ ფასდაკლებას შესაბამის მკურნალობებზე.",
          "პაციენტები Clinifly აპიდან პირად რეფერალ ბმულს აზიარებენ.",
          "მეგობრის შეერთებისა და მკურნალობის შემდეგ ორივე იღებს კონფიგურირებულ ფასდაკლებას.",
          "რეფერალებს ადმინის გვერდით მენიუში Referrals-ში თვალყურს ადევთ."
        ],
        tips: [
          "დაიწყეთ ზომიერი ფასდაკლებით (5–10%) და გაზარდეთ, თუ რეფერალები ნელია."
        ],
        linkLabel: "Referrals-ის გახსნა",
      },
      "referral-invite-friends": {
        title: "როგორ მოიწვევენ პაციენტები მეგობრებს",
        what: "პაციენტები მეგობრებს მოიწვევენ Clinifly პაციენტის აპში რეფერალ კოდით ან ბმულით.",
        why: "მკურნალობის შემდეგ პაციენტის სიტყვა ცივ კონტაქტზე უკეთ მუშაობს.",
        how: [
          "დარწმუნდით, რომ Referral Discount Settings-ში დაყენებულია.",
          "დამტკიცებულ პაციენტებს რეფერალ პროგრამაზე უთხარით წარმატებული მკურნალობის შემდეგ.",
          "პაციენტები აპში პოულობენ რეფერალ ბმულს და აზიარებენ WhatsApp-ზე ან სოც. ქსელებში.",
          "ახალ პაციენტებს ჩვეულებრივ Patients-ში დაამტკიცებთ."
        ],
        linkLabel: "Invite Patients-ის გახსნა",
      },
      "referral-benefits": {
        title: "რეფერალების სარგებელი კლინიკისთვის",
        what: "კლინიკები რეფერალებით იღებენ მეტ პაციენტს, ნაკლებ მარკეტინგის ხარჯს და მეგობრის რეკომენდაციის უფრო მაღალ ნდობას.",
        why: "რეფერალური პაციენტები უკვე ენდობიან კლინიკას მოსვლამდე. ხშირად სწრაფად ეთანხმებიან მკურნალობის გეგმას.",
        how: [
          "Referrals გვერდზე თვალყური ადევით Pending და დასრულებულ რეფერალებს.",
          "რეფერალურ პაციენტებს სწრაფად დაამტკიცეთ.",
          "ფასდაკლება Settings-ის წესების მიხედვით გადახდისას გამოიყენეთ.",
          "რეფერალ პაციენტებს მადლობა გადაუხადეთ — ეს მეტ მოწვევას უწყობს ხელს."
        ],
        linkLabel: "Referrals-ის გახსნა",
      },
      "faq-clinic-code": {
        title: "რა არის Clinic Code?",
        what: "Clinic Code არის მოკლე სიტყვა, რომელსაც კლინიკა რეგისტრაციისას ირჩევს (მაგ. კლინიკის სახელი ან აბრევიატურა).",
        why: "ექიმები და პაციენტები იმავე კოდს იყენებენ მობილურ აპში კლინიკასთან დასაკავშირებლად.",
        how: [
          "თქვენ ქმნით Register Clinic-ზე — Clinifly არ გიგზავნით კოდს ელფოსტით.",
          "გაუზიარეთ ექიმებს და რეცეფციაზე გამოაჩინეთ პაციენტებისთვის.",
          "თუ დაგავიწყდათ, შეამოწმეთ ვინ დარეგისტრირა ანგარიში ან დაუკავშირდით Clinifly მხარდაჭერას."
        ],
      },
      "faq-doctor-or-ai": {
        title: "ექიმი თუ AI — ვინ პასუხობს?",
        what: "დამტკიცებული ექიმები და AI ორივე შეუძლიათ პასუხი პაციენტის შეტყობინებებზე.",
        why: "თქვენ ირჩევთ ავტომატიზაციასა და პირად მოვლას შორის ბალანსს.",
        how: [
          "Doctors-ში დაამტკიცეთ ექიმები, Lead inbox-ში მიანიჭეთ.",
          "Settings → AI Communication: Instant (AI პირველად), Wait for human ან Human-only.",
          "ექიმები მობილური აპიდან პასუხობენ; AI WhatsApp/Messenger-ზე ავტომატურად."
        ],
        linkLabel: "Settings-ის გახსნა",
      },
      "faq-profile-vs-settings": {
        title: "Directory Profile vs Settings",
        what: "Settings არის უკანაოფისი (ფასები, AI, მისამართი). Directory Profile არის საჯარო ვიტრინა პაციენტის ძებნისთვის.",
        why: "ორის არეულობა ყველაზე ხშირი შეცდომაა — პაციენტები Settings-ს არ ხედავენ, მხოლოდ Directory Profile-ს.",
        how: [
          "Settings: შიდა ინფორმაცია, Treatment Price List, AI Communication, WhatsApp/Messenger.",
          "Directory Profile: ლოგო, აღწერა, ფოტოები, სპეციალობები, ენები, Google რევიუები, სოც. ბმულები, publish toggle.",
          "სრულად მუშა კლინიკისთვის ორივე შეავსეთ."
        ],
        linkLabel: "Directory Profile-ის გახსნა",
      },
      "faq-setup-order": {
        title: "რეკომენდებული დაყენების რიგი",
        what: "რეკომენდებული დაყენების რიგი ყველაზე სწრაფად მიგიყვანთ პაციენტების მიღებამდე.",
        why: "რიგის დაცვა თავიდან აგარიდებთ ხელახალ სამუშაოს — მაგ. WhatsApp-ის დაკავშირება ფასების დაყენებამდე არასწორ AI ციტირებას იწვევს.",
        how: [
          "1. Register → Login",
          "2. Settings: კლინიკის ინფო, AI Training, Treatment Price List",
          "3. Directory Profile: შეავსეთ და გამოაქვეყნეთ",
          "4. Doctors: დაამტკიცეთ აპში → Lead inbox-ში მიანიჭეთ",
          "5. დააკავშირეთ WhatsApp და/ან Messenger",
          "6. გაუზიარეთ Invite Patients ბმული"
        ],
        linkLabel: "სრული სახელმძღვანელოს ნახვა",
      },
      "faq-support": {
        title: "Clinifly მხარდაჭერასთან დაკავშირება",
        what: "Clinifly მომხმარებლის მხარდაჭერა ეხმარება ანგარიშის საკითხებში, Meta/WhatsApp დაკავშირებასა და დაყენების დაბლოკვებში.",
        why: "ზოგიერთ ნაბიჯს (Meta Business ვერიფიკაცია, webhook პრობლემები) პირადი დახმარება სჭირდება.",
        how: [
          "ელფოსტა: support@clinifly.net — მიუთითეთ კლინიკის სახელი და ადმინის ელფოსტა.",
          "აღწერეთ, რომელ ეკრანზე გაჭედეთ და სურათები თუ შეგიძლიათ მიურთეთ.",
          "სახელმძღვანელო ვიდეოები ნახეთ https://www.youtube.com/@Clinifly-ზე"
        ],
      },
      "faq-videos": {
        title: "სახელმძღვანელო ვიდეოები YouTube-ზე",
        what: "Clinifly YouTube-ზე ნაბიჯ-ნაბიჯ ვიდეო სახელმძღვანელოებს აქვეყნებს — რეგისტრაცია, Settings, AI და არხების დაყენება.",
        why: "ვიდეოები ზუსტად ადმინის ეკრანებს გიჩვენებთ — სასარგებლოა, თუ ნახვას კითხვაზე ანიჭებთ უპირატესობას.",
        how: [
          "გახსენით https://www.youtube.com/@Clinifly",
          "იპოვეთ თქვენს კითხვას შესაბამისი ვიდეო (რეგისტრაცია, Directory Profile, WhatsApp და ა.შ.).",
          "თან ადევით ადმინ პანელში."
        ],
        linkLabel: "YouTube სახელმძღვანელოების გახსნა",
      },
    },
    tr: {
      "create-clinic-register": {
        title: "Klinik nasıl oluşturulur",
        what: "Register Clinic, Clinifly yönetici hesabınızı oluşturduğunuz ve klinik adınızı ile Clinic Code'unuzu seçtiğiniz yerdir.",
        why: "Doktor, hasta veya herkese açık profil eklemeden önce bir yönetici hesabına ihtiyacınız var. Kayıt ücretsizdir ve birkaç dakika sürer.",
        how: [
          "Register Clinic'i açın ve hastaların görmesi gereken klinik adını girin.",
          "Bir Clinic Code seçin — personelinizin ve hastalarınızın hatırlayacağı kısa bir kelime (örneğin MOON veya ELKO). Bunu siz oluşturursunuz; Clinifly size e-postayla kod göndermez.",
          "E-posta ve şifrenizi girin (en az 6 karakter), ardından şifreyi onaylayın.",
          "İsteğe bağlı: telefon ve adresi şimdi ekleyin veya daha sonra Settings'te doldurun.",
          "Register Clinic'e tıklayın, ardından aynı e-posta, Clinic Code ve şifre ile giriş yapın."
        ],
        tips: [
          "Clinic Code'u kısa tutun — yalnızca harf ve rakam, boşluk yok.",
          "Invitation Code isteğe bağlıdır — yalnızca Clinifly veya bir ortak size kampanya kodu verdiyse kullanın."
        ],
        linkLabel: "Register Clinic'i aç",
      },
      "create-clinic-approval": {
        title: "Klinik onayı nasıl çalışır",
        what: "Kayıttan sonra klinik hesabınız hemen aktif olur. Bazı ortak veya deneme programlarında, herkese açık dizinde görünmeden önce Clinifly'nin bilgilerinizi doğrulaması gerekebilir.",
        why: "Doğrulama hastaları korur ve klinik dizinini güvenilir tutar. Profilinizi tamamlarken kliniğinizi kurmaya, doktor eklemeye ve mesajlaşmayı bağlamaya devam edebilirsiniz.",
        how: [
          "Kayıttan sonra yönetici Dashboard'una giriş yapın.",
          "Settings (adres, klinik adı) ve Directory Profile'ı tamamlayın — eksiksiz profil onay ve hasta güvenine yardımcı olur.",
          "Hesabınızda askıya alma veya inceleme bildirimi görürseniz, klinik adı ve e-postanızla Clinifly desteğine ulaşın.",
          "Doğrulandıktan sonra Directory Profile sayfanızda Publish to public directory'yi açın."
        ],
        tips: [
          "Eksik adres konum özelliklerini engeller — önce Settings'te ekleyin."
        ],
        linkLabel: "Dashboard'u aç",
      },
      "create-clinic-update-info": {
        title: "Klinik bilgileri nasıl güncellenir",
        what: "Settings'te klinik adınızı, logonuzu, adresinizi, koltuk sayısını, referans indirimini ve Google Maps bağlantısını güncellersiniz.",
        why: "Doğru klinik bilgileri hastaların sizi bulmasına yardımcı olur, takviminizi güçlendirir ve AI asistanınıza doğru ayrıntılar sağlar.",
        how: [
          "Kenar çubuğunda Settings'i açın.",
          "Clinic Name, Logo URL, Address, Chair count ve Google Maps bağlantısını güncelleyin.",
          "Referans programı kullanıyorsanız Referral Discount (%) ayarlayın.",
          "Üstte Save Settings'e tıklayın — kaydetmeden değişiklikler saklanmaz."
        ],
        tips: [
          "Chair count takviminizde kaç randevu sütunu görüneceğini belirler.",
          "Logo için doğrudan görsel bağlantısı kullanın — URL'yi tarayıcıda açarak test edin."
        ],
        linkLabel: "Settings'i aç",
      },
      "doctors-invite": {
        title: "Doktor nasıl davet edilir",
        what: "Doktorları Clinic Code'unuzu paylaşarak davet edersiniz. Her doktor Clinifly mobil uygulamasını yükler ve bu kodla Doctor olarak kayıt olur.",
        why: "Onaylanan doktorlar programları görür, hastalarla sohbet eder ve yeni hasta mesajlarına birincil yanıt veren olarak atanabilir.",
        how: [
          "Doktorunuza App Store'dan (iPhone) veya Google Play'den (Android) Clinifly uygulamasını indirmesini söyleyin.",
          "Clinic Code'unuzu paylaşın — kayıtta seçtiğiniz aynı kod.",
          "Doctor olarak (Patient değil) kayıt olmasını ve profilini tamamlamasını isteyin.",
          "Başvurusunu yönetici panelinde Doctors altında göreceksiniz."
        ],
        tips: [
          "Clinic Code'u klinikte bir posterde yazın, böylece personel her zaman doğru kodu kullanır."
        ],
        linkLabel: "Doctors'u aç",
      },
      "doctors-join": {
        title: "Doktor kliniğe nasıl katılır",
        what: "Doktorlar Clinifly mobil uygulamasında Clinic Code'unuz ve Doctor rolüyle kayıt olur.",
        why: "Mobil uygulama, tedavi eden doktorların gününü yönetme yoludur — program, hasta sohbeti ve vaka güncellemeleri — kliniğinize bağlı.",
        how: [
          "Doktor Clinifly uygulamasını açar → Register → Doctor seçer.",
          "Clinic Code'unuzu kayıttaki gibi tam girer (bazı durumlarda büyük/küçük harf önemlidir).",
          "Ad, uzmanlık ve iletişim bilgilerini doldurur, ardından gönderir.",
          "Klinik hastalarına erişmeden önce klinik yöneticisinin onayını bekler."
        ],
        tips: [
          "Doktor yanlışlıkla Patient olarak kayıt olduysa yeni bir Doctor hesabı oluşturması gerekir."
        ],
        linkLabel: "Doctors'u aç",
      },
      "doctors-approval": {
        title: "Doktor onay süreci",
        what: "Doktor onayı, klinik yöneticisinin doktor başvurusunu kabul etmesi ve klinik verilerine erişim vermesidir.",
        why: "Onay hasta listenizi korur — yalnızca güvendiğiniz doktorlar kliniğinizin hastalarını ve mesajlarını görür.",
        how: [
          "Yönetici kenar çubuğunda Doctors'u açın.",
          "Bekleyen başvuruları bulun.",
          "Doktorun adını ve bilgilerini inceleyin.",
          "Approve'e tıklayın.",
          "Onaydan sonra Lead inbox'ta doktoru atayın, böylece hasta mesajları ona gider."
        ],
        tips: [
          "Onaylanmadan doktorlar hastaları göremez — bu adımı unutmayın."
        ],
        linkLabel: "Doktorları onayla",
      },
      "doctors-roles": {
        title: "Doktor rolleri ve izinler",
        what: "Klinik yöneticisi klinik hesabını kontrol eder. Onaylanan doktorlar mobil uygulamayı kullanır. Lead inbox, hasta mesajlarına birincil yanıt veren kişiyi belirler.",
        why: "Net roller karışıklığı önler — hastalar kiminle konuştuğunu bilir, ekibiniz kimin önce yanıt vermesi gerektiğini bilir.",
        how: [
          "Klinik yöneticisi: Settings, fiyatlar, Directory Profile ve doktor onayına tam erişim.",
          "Doctor (mobil uygulama): program, hasta sohbeti, tedaviler — yönetici onayından sonra.",
          "Lead inbox: hasta görüşmesi başına birincil doktor atama.",
          "AI Communication (Settings): WhatsApp ve Messenger'da AI, insan veya ikisinin yanıt vermesini seçin."
        ],
        tips: [
          "Önce doktoru onaylayın, sonra Lead inbox'ta atayın — sıra önemlidir."
        ],
        linkLabel: "Lead Inbox'u aç",
      },
      "patients-join": {
        title: "Hastalar kliniğe nasıl katılır",
        what: "Hastalar Clinifly uygulamasını indirerek, Clinic Code'unuzu girerek veya davet bağlantınızı/QR kodunuzu kullanarak kliniğinize katılır.",
        why: "Bağlı hastalar tedavi talepleri, fotoğraflar gönderebilir, ekibinizle sohbet edebilir ve Clinifly üzerinden randevu alabilir.",
        how: [
          "Hasta Clinifly uygulamasını indirir ve Patient kaydını seçer.",
          "Clinic Code'unuzu girer veya davet QR'ını tarar / davet bağlantısını açar.",
          "Profilini tamamlar ve katılma talebi gönderir.",
          "Talebi Patients altında Pending durumunda görürsünüz."
        ],
        tips: [
          "Davet bağlantısı ve QR (Invite Patients menüsü) hastalar için kod yazmaktan daha kolaydır."
        ],
        linkLabel: "Patients'ı aç",
      },
      "patients-approval": {
        title: "Hasta onayı nasıl çalışır",
        what: "Hasta onayı, bir hastanın kliniğinize katılma talebini kabul etmenizdir.",
        why: "Hasta listenizde kimlerin olduğunu siz kontrol edersiniz. Yalnızca onaylanan (aktif) hastalar plan limitlerinize sayılır ve kliniğinize mesaj atabilir.",
        how: [
          "Yönetici kenar çubuğunda Patients'ı açın.",
          "Pending hastaları bulun veya filtreleyin.",
          "Hasta adını ve bilgilerini inceleyin.",
          "Aktifleştirmek için Approve'e tıklayın.",
          "Reddedilen veya bekleyen hastalar klinik özelliklerini tam kullanamaz."
        ],
        tips: [
          "Uluslararası hastaları hızlı onaylayın — genellikle katılır katılmaz mesaj atarlar."
        ],
        linkLabel: "Patients'ı aç",
      },
      "patients-invite": {
        title: "Hastalar nasıl davet edilir",
        what: "Invite Patients size paylaşılabilir bir bağlantı ve QR kod verir; hastalar klinik kodunuzu yazmadan katılır.",
        why: "WhatsApp, Instagram veya resepsiyonda bağlantı veya QR paylaşmak hasta listenizi büyütmenin en hızlı yoludur.",
        how: [
          "Kenar çubuğunda Patients → Invite Patients'i açın.",
          "Davet bağlantınızı kopyalayın veya QR kodunu indirin/yazdırın.",
          "WhatsApp, e-posta, sosyal medya veya resepsiyonda paylaşın.",
          "Hasta bağlantıyı açtığında doğrudan kliniğinize katılmaya yönlendirilir.",
          "Talep göründüğünde Patients altında onaylayın."
        ],
        tips: [
          "Davet bağlantısını Instagram bio'nuz ve web sitenize ekleyin."
        ],
        linkLabel: "Invite Patients'ı aç",
      },
      "patients-connect-doctors": {
        title: "Hastalar doktorlara nasıl bağlanır",
        what: "Hasta katıldıktan sonra Lead inbox'ta birincil yanıt veren atayarak onu bir doktora bağlarsınız.",
        why: "Hastalar adı bilinen bir doktor veya koordinatör bekler. Atama, mesajların doğru kişiye ulaşmasını ve doktorun uygulamasında görünmesini sağlar.",
        how: [
          "Patients altında hastayı onaylayın.",
          "Doctors altında en az bir doktoru onaylayın.",
          "Lead inbox → Needs assignment'ı açın.",
          "Hasta görüşmesini seçin ve doktorunuzu primary responder olarak atayın.",
          "Doktor hastayı mobil uygulamasında görür; AI Settings'e göre yardımcı olabilir."
        ],
        tips: [
          "Birden fazla doktorunuz varsa Lead inbox ayarlarında otomatik yönlendirmeyi açın."
        ],
        linkLabel: "Lead Inbox'u aç",
      },
      "profile-logo": {
        title: "Klinik logonuzu ekleyin",
        what: "Klinik logonuz, hastaların Clinifly uygulamasında kliniklere göz atarken gördüğü ana görseldir.",
        why: "Profesyonel bir logo anında güven oluşturur. Directory Profile'da herkese açık listeye yayınlamak için logo gereklidir.",
        how: [
          "Yönetici menüsünde Directory Profile'ı açın.",
          "Clinic Info'da logo görsel URL'sini yükleyin veya yapıştırın.",
          "Temiz arka planda kare veya geniş logo kullanın.",
          "Profili kaydedin ve Profile completion'ı kontrol edin — logo tamamlanmış olmalı."
        ],
        tips: [
          "Logo URL'sini Settings'te de ayarlayabilirsiniz; aramada görünen Directory Profile'dır."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "profile-description": {
        title: "Klinik açıklamanızı yazın",
        what: "Açıklamanız uluslararası hastalara kliniğinizi özel kılan şeyleri anlatır — tedaviler, deneyim ve konum vurguları.",
        why: "Hastalar mesaj atmadan önce birkaç kliniği karşılaştırır. Net, samimi bir açıklama talepleri artırır.",
        how: [
          "Directory Profile → Clinic Info.",
          "Kliniğiniz, temel tedavileriniz ve neden sizi seçtikleri hakkında 2–4 kısa paragraf yazın.",
          "İlgiliyse konuşulan dilleri ve tipik uluslararası hasta ülkelerini belirtin.",
          "Kaydedin ve açıklamanın Profile completion'da göründüğünü kontrol edin."
        ],
        tips: [
          "Diş hekimleri için değil, hastalar için yazın — sonuçlara ve konfora odaklanın."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "profile-photos": {
        title: "Klinik fotoğrafları ekleyin",
        what: "Fotoğraflar dizinde gezinirken kliniğinizin içini, ekibinizi ve ekipmanınızı gösterir.",
        why: "Fotoğraflar ziyaretin en iyi alternatifidir. Fotoğraflı klinikler uluslararası hastalardan daha fazla mesaj alır.",
        how: [
          "Directory Profile → Media gallery.",
          "Resepsiyon, tedavi odaları ve ekip (izinle) için görsel URL'leri ekleyin.",
          "Aydınlık, dürüst fotoğraflar kullanın — ağır filtrelerden kaçının.",
          "Profili kaydedin; fotoğraflar tamamlanma puanına sayılır."
        ],
        tips: [
          "3–5 iyi fotoğraf bile büyük fark yaratır."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "profile-specialties": {
        title: "Uzmanlıklarınızı seçin",
        what: "Specialties, kliniğinizin sunduğu tedavileri listeler — implantlar, veneerler, ortodonti ve daha fazlası.",
        why: "Hastalar uzmanlığa göre arar ve filtreler. Eksik uzmanlık ilgili aramalarda görünmemenize neden olur.",
        how: [
          "Directory Profile → Specialties.",
          "Aktif olarak sunduğunuz her tedaviyi seçin.",
          "Tutarlı AI yanıtları için uzmanlıkları Settings'teki Treatment Price List ile eşleştirin.",
          "Profili kaydedin — yayınlamak için en az bir uzmanlık gerekir."
        ],
        tips: [
          "Artık sunmadığınız tedavileri listelemeyin — hem profili hem fiyat listesini güncelleyin."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "profile-languages": {
        title: "Konuştuğunuz dilleri listeleyin",
        what: "Languages, ekibinizin hangi dillerde iletişim kurabildiğini hastalara gösterir.",
        why: "Uluslararası hastalar dile göre filtreler. English, Arabic, Russian ve diğerlerini listelemek doğru hastaları size getirir.",
        how: [
          "Directory Profile → Languages.",
          "Resepsiyon ve doktorlarınızın konuştuğu tüm dilleri seçin.",
          "Profili kaydedin — yayınlamak için en az bir dil gerekir.",
          "Yapılandırıldığında AI asistanınız da birden fazla dilde yanıt verebilir."
        ],
        tips: [
          "Yalnızca ekibinizin canlı olarak iletişim kurabildiği dilleri listeleyin — sadece AI çevirisi değil."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "profile-doctors": {
        title: "Profilinizde doktorları gösterin",
        what: "Herkese açık profilinizde doktorları listelemek hastalara kimlerin tedavi edeceğini gösterir.",
        why: "Fotoğraf ve uzmanlıklı adı bilinen doktorlar güveni artırır, özellikle yurtdışında estetik ve cerrahi tedaviler için.",
        how: [
          "Önce yönetici panelinde Doctors altında doktorları onaylayın.",
          "Directory Profile → Doctors section.",
          "Herkese açık listede hangi onaylı doktorların görüneceğini seçin.",
          "Her doktorun mobil uygulamada eksiksiz profili olduğundan emin olun.",
          "Profile completion yüksek olduğunda kaydedin ve yayınlayın."
        ],
        tips: [
          "Publish to public directory'yi yalnızca logo, açıklama, uzmanlık ve dil tamamlandığında açın."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "google-find-profile": {
        title: "Google Business profilinizi nasıl bulursunuz",
        what: "Google Business Profile, hastaların kliniğiniz hakkında yorum bıraktığı Google Maps ve Search sayfasıdır.",
        why: "Uluslararası hastalar genellikle Clinifly'ye yazmadan önce Google yorumlarını kontrol eder. Puanınızı Clinifly'de göstermek anında güven oluşturur.",
        how: [
          "Google Maps'te klinik adınızı arayın.",
          "Kliniğinizin kaydını açın — bu sizin Google Business Profile'ınızdır.",
          "Yoksa business.google.com'da klinik adresinizle oluşturun.",
          "Profili yönettiğinizden emin olun (doğrulanmış sahip veya yönetici erişimi)."
        ],
        tips: [
          "Memnun hastalardan Google yorumu bırakmalarını isteyin — hem Google hem Clinifly profilinize yardımcı olur."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "google-copy-maps-link": {
        title: "Google Maps bağlantınızı nasıl kopyalarsınız",
        what: "Google Maps bağlantınız, kliniğinizin Google'daki web adresidir — hastalar yön ve yorumlar için bunu kullanır.",
        why: "Clinifly bu bağlantıyı, hastaların size yazmadan önce kliniğinizi Google'da doğrulaması için kullanır.",
        how: [
          "Google Maps'te kliniğinizi bulun.",
          "Share'e (veya paylaş simgesine) tıklayın.",
          "Bağlantıyı kopyalayın — genellikle https://maps.app.goo.gl/… veya https://g.page/… gibi görünür.",
          "Bağlantıyı tarayıcıda test edin — Google Maps'te kliniğiniz açılmalı."
        ],
        tips: [
          "Rastgele arama sonucu URL'si değil, Google Maps'ten kısa paylaşım bağlantısını kullanın."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "google-add-to-clinifly": {
        title: "Yorum bilgilerini Clinifly'ye nasıl eklersiniz",
        what: "Google yorum bilgilerini Clinifly'ye eklemek, herkese açık dizin profilinizde yıldız puanınızı ve yorum sayınızı gösterir.",
        why: "Yurtdışında klinik karşılaştıran hastalar yorum puanına güvenir. Clinifly'de göstermek sizi seçmelerinin nedeni olabilir.",
        how: [
          "Directory Profile → Reputation & Trust.",
          "Google Business URL alanına Google Business URL'nizi yapıştırın.",
          "Google profilinizden Google Rating (0–5) ve Google Review Count girin.",
          "Profili kaydedin.",
          "Yeni yorumlar aldıkça bu sayıları birkaç ayda bir güncelleyin."
        ],
        tips: [
          "Dürüst, güncel sayılar girin — hastalar Google'ı kendileri de kontrol edebilir."
        ],
        linkLabel: "Reputation Section'ı aç",
      },
      "social-website": {
        title: "Web sitenizi ekleyin",
        what: "Directory Profile'daki web sitesi bağlantısı, hastaların mesaj atmadan önce klinik sitenizi ziyaret etmesini sağlar.",
        why: "Bir web sitesi (veya açılış sayfası) gerçek bir klinik olduğunuzu doğrular. Henüz sosyal bağlantınız yoksa profili yayınlamak için gereklidir.",
        how: [
          "Directory Profile → Social & Web.",
          "https:// dahil tam web sitesi URL'nizi yapıştırın.",
          "Bağlantının doğru açıldığını test edin.",
          "Profili kaydedin."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "social-instagram": {
        title: "Instagram ekleyin",
        what: "Instagram bağlantınız hastaların önce/sonra fotoğraflarını ve günlük klinik yaşamını görmesini sağlar.",
        why: "Estetik ve diş turizmi hastaları genellikle klinikleri önce Instagram'da keşfeder. Bağlamak uygulamada güven oluşturur.",
        how: [
          "Instagram profil URL'nizi kopyalayın (instagram.com/yourclinic).",
          "Directory Profile → Social & Web → Instagram'a yapıştırın.",
          "Profili kaydedin."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "social-facebook": {
        title: "Facebook ekleyin",
        what: "Facebook Page bağlantınız herkese açık klinik varlığınızı bağlar ve Messenger entegrasyonuyla çalışır.",
        why: "Birçok hasta kliniklere Facebook'tan mesaj atar. Sayfanızı bağlamak doğrulamaya yardımcı olur ve Clinifly Messenger kurulumuna bağlanır.",
        how: [
          "Facebook Page URL'nizi kopyalayın (facebook.com/yourpage).",
          "Directory Profile → Social & Web → Facebook'a yapıştırın.",
          "Facebook mesajlarını Clinifly'de almak için Settings altında Messenger'ı da bağlayın.",
          "Profili kaydedin."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "social-tiktok": {
        title: "TikTok ekleyin",
        what: "TikTok kliniğinizin, ekibinizin ve hasta hikayelerinin kısa videolarını gösterir.",
        why: "Genç uluslararası hastalar genellikle klinikleri TikTok üzerinden bulur. Eklemek kliniğinizin aktif ve modern olduğunu doğrular.",
        how: [
          "TikTok profil URL'nizi kopyalayın.",
          "Directory Profile → Social & Web → TikTok'a yapıştırın.",
          "Profili kaydedin."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "social-youtube": {
        title: "YouTube ekleyin",
        what: "YouTube daha uzun videolar barındırır — klinik turları, doktor tanıtımları, tedavi açıklamaları.",
        why: "Video, yurtdışında tedavi için seyahat eden hastalar için derin güven oluşturur.",
        how: [
          "YouTube kanal veya klinik video sayfası URL'nizi kopyalayın.",
          "Directory Profile → Social & Web → YouTube'a yapıştırın.",
          "Profili kaydedin."
        ],
        tips: [
          "Clinifly'nin yönetici kurulum eğitim videoları da https://www.youtube.com/@Clinifly adresindedir."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "social-linkedin": {
        title: "LinkedIn ekleyin",
        what: "LinkedIn kliniğinizin profesyonel ve kurumsal varlığını gösterir.",
        why: "Gurbetçi profesyonelleri ve kurumsal diş planlarını hedefleyen klinikler için faydalıdır.",
        how: [
          "Klinik LinkedIn şirket sayfası URL'nizi kopyalayın.",
          "Directory Profile → Social & Web → LinkedIn'e yapıştırın.",
          "Profili kaydedin."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "ai-enable": {
        title: "AI nasıl etkinleştirilir",
        what: "AI'yi etkinleştirmek otomatik yanıtları açmak ve AI'yi kliniğinizin bilgileri, fiyatları ve tonuyla eğitmek demektir.",
        why: "Uluslararası hastalar genellikle mesai saatleri dışında yazar. AI saniyeler içinde yanıt verir, yaygın soruları yanıtlar ve ekibiniz uyurken fotoğraf toplar.",
        how: [
          "Settings → AI Training Center'ı açın — politikaları, tonu ve AI'nin bilmesi gerekenleri öğretin.",
          "Settings → Treatment Price List — fiyatları girin (AI bu listeden fiyat verir).",
          "Settings → AI Communication — Instant AI replies seçin (başlangıç için önerilir).",
          "Communication Channels altında WhatsApp ve/veya Messenger'ı bağlayın.",
          "AI'nin gerçekçi randevu saatleri sunması için klinik saatleri ve saat dilimini ayarlayın."
        ],
        tips: [
          "Klinik bilgilerini ve fiyatları kaydettikten sonra AI'yi eğitin — aksi halde yanıtlar genel olur."
        ],
        linkLabel: "Settings'i aç",
      },
      "ai-answers": {
        title: "AI hastalara nasıl yanıt verir",
        what: "AI, Treatment Price List, AI Training Center içeriği, Directory Profile ve klinik saatlerinizi kullanarak hastalara yanıt verir.",
        why: "Tutarlı, hızlı yanıtlar kayıp talepleri azaltır. Hastalar saatlerce beklemeden fiyat aralıkları, tedavi bilgisi ve sonraki adımları alır.",
        how: [
          "Fiyatlar Settings → Treatment Price List'ten gelir (implant markaları için Variants kullanın).",
          "Politikalar ve ton AI Training Center'dan gelir.",
          "Saatler ve randevu kuralları Settings → AI Communication'dan gelir.",
          "Lead inbox ve Coordination Center'da AI görüşmelerini inceleyerek eğitimi zamanla geliştirin."
        ],
        tips: [
          "İmplant marka fiyatlarını AI adları altına yazmayın — Variants kullanın."
        ],
        linkLabel: "AI Training Center'ı aç",
      },
      "ai-whatsapp": {
        title: "WhatsApp entegrasyonu",
        what: "WhatsApp entegrasyonu kliniğinizin WhatsApp Business numarasını bağlar; hasta sohbetleri Clinifly'de görünür ve AI yanıt verebilir.",
        why: "WhatsApp uluslararası diş hastaları için 1 numaralı kanaldır. Bağlamak tüm mesajları tek gelen kutusunda toplar.",
        how: [
          "Settings → Communication Channels → WhatsApp (veya kenar çubuğundan WhatsApp'ı açın).",
          "Connect with Meta'ya tıklayın ve Meta Business hesabınızla giriş yapın.",
          "WhatsApp Business numaranızı seçin — numaranız sizde kalır.",
          "Test mesajı gönderin, AI'yi yapılandırın, ardından canlıya geçmek için WhatsApp'ı ON yapın."
        ],
        tips: [
          "WhatsApp'ta canlıya geçmeden önce Treatment Price List ve AI Training'i tamamlayın."
        ],
        linkLabel: "WhatsApp Setup'ı aç",
      },
      "ai-messenger": {
        title: "Messenger entegrasyonu",
        what: "Messenger entegrasyonu kliniğinizin Facebook Page'ini bağlar; Facebook'tan gelen sohbetler Clinifly'de görünür.",
        why: "Birçok hasta Facebook Messenger'ı tercih eder. WhatsApp, Messenger ve uygulama mesajları için tek gelen kutusu ekibinize zaman kazandırır.",
        how: [
          "Settings → Communication Channels → Messenger.",
          "Connect Facebook'a tıklayın — klinik Page'inizi yöneten bir hesap kullanın.",
          "Bağlandıktan sonra AI modunu klinik AI'nize ayarlayın (Clinifly Sales AI değil).",
          "Mesajlar gelmiyorsa Messenger diagnostics çalıştırın."
        ],
        tips: [
          "Meta Business Suite'te klinik Page'inize Admin erişimi olan bir Facebook hesabı kullanın."
        ],
        linkLabel: "Messenger Setup'ı aç",
      },
      "ai-human-takeover": {
        title: "İnsan devralması",
        what: "Human takeover, AI ilk yanıtları verirken ekibinizin manuel yanıt vermesine veya hassas görüşmelerde AI'yi tamamen duraklatmanıza olanak tanır.",
        why: "Bazı durumlar gerçek bir doktor gerektirir — karmaşık tıbbi sorular, kızgın hastalar veya nihai tedavi kararları.",
        how: [
          "Settings → AI Communication → personelin önce yanıt vermesini istiyorsanız Wait for human before AI seçin.",
          "Instant mod: AI saniyeler içinde yanıt verir; ekibiniz Lead inbox veya Chat'ten istediği zaman devreye girebilir.",
          "Human-only mod: AI otomatik yanıtı tamamen kapatır.",
          "Doktorlar mobil uygulamadan yanıtlar; yöneticiler web Chat sayfasından."
        ],
        tips: [
          "Yanıtlara güvenene kadar Instant AI + Lead inbox'u günlük izleyerek başlayın."
        ],
        linkLabel: "AI Communication'ı aç",
      },
      "intl-find-clinics": {
        title: "Uluslararası hastalar klinikleri nasıl bulur",
        what: "Uluslararası hastalar Clinifly hasta uygulamasında klinik dizinine göz atarak bulur — ülke, uzmanlık ve dile göre filtrelenir.",
        why: "Eksiksiz, yayınlanmış Directory Profile yurtdışından sizi keşfetme yolunuzdur. Eksik profiller nadiren mesaj alır.",
        how: [
          "Directory Profile'ı %100 tamamlayın — logo, açıklama, uzmanlıklar, diller, fotoğraflar, yorumlar.",
          "Publish to public directory'yi açın.",
          "Güven için Google yorumları ve sosyal bağlantılar ekleyin.",
          "Hastalar yazdığında AI'nin fiyat verebilmesi için Treatment Price List'i güncel tutun."
        ],
        tips: [
          "Directory Profile'ı uluslararası hastalar için vitrininiz olarak düşünün."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "intl-multilingual": {
        title: "Çok dilli iletişim nasıl çalışır",
        what: "Çok dilli iletişim, hastaların kendi dillerinde yazması ve AI'nizin veya ekibinizin anladıkları bir dilde yanıt vermesi demektir.",
        why: "Diş turizmi hastaları nadiren yerel dili akıcı konuşur. Çok dilli yanıtlar dönüşümü önemli ölçüde artırır.",
        how: [
          "Directory Profile'da konuşulan dilleri listeleyin.",
          "Hizmet verdiğiniz dillerde temel ifadeleri AI Training Center'da eğitin.",
          "Mümkün olduğunda hastanın dilini konuşan bir doktor veya koordinatör atayın.",
          "AI, hastanın dilinden bağımsız olarak eğitiminizi ve fiyat listenizi kullanır."
        ],
        tips: [
          "Her dilde karmaşık tıbbi vakalar için AI yanıtlarını mutlaka bir insan incelemelidir."
        ],
        linkLabel: "AI Training Center'ı aç",
      },
      "intl-photos-requests": {
        title: "Hastalar fotoğraf ve tedavi taleplerini nasıl gönderir",
        what: "Hastalar uygulama, WhatsApp veya Messenger üzerinden ağız fotoğrafları ve tedavi talepleri gönderir. Bunlar gelen kutunuzda talep olarak görünür.",
        why: "Uzaktan konsültasyonlar fotoğraflarla başlar. Hızlı inceleme ve yanıt uluslararası vakaları kazandırır.",
        how: [
          "Hasta uygulama sohbeti, WhatsApp veya Messenger ile fotoğraf gönderir.",
          "Lead inbox veya Coordination Center'da yeni talepleri görün.",
          "Fotoğrafları incelemek ve tedavi planı veya fiyatla yanıtlamak için bir doktor atayın.",
          "Paylaşılan hasta belgelerine erişmek için yönetici Files'ı kullanın."
        ],
        tips: [
          "24 saat içinde yanıt verin — uluslararası hastalar aynı anda birden fazla kliniğe yazar."
        ],
        linkLabel: "Lead Inbox'u aç",
      },
      "referral-how": {
        title: "Referanslar nasıl çalışır",
        what: "Referans sistemi, arkadaşlarını kliniğinize davet eden mevcut hastaları tedavilerde indirimle ödüllendirir.",
        why: "Mutlu hastalarınız en iyi pazarlamacılarınızdır. Referanslar reklamlardan daha düşük maliyetle nitelikli talepler getirir.",
        how: [
          "Settings → Referral Discount (%) ayarlayın — hem davet eden hem yeni hasta uygun tedavilerde bu indirimi alır.",
          "Hastalar Clinifly uygulamasından kişisel referans bağlantılarını paylaşır.",
          "Arkadaş katılıp tedavi olduğunda ikisi de yapılandırılmış indirimi alır.",
          "Referansları yönetici kenar çubuğunda Referrals altında takip edin."
        ],
        tips: [
          "Mütevazı bir indirimle (5–10%) başlayın, referanslar yavaşsa artırın."
        ],
        linkLabel: "Referrals'ı aç",
      },
      "referral-invite-friends": {
        title: "Hastalar arkadaşlarını nasıl davet eder",
        what: "Hastalar Clinifly hasta uygulamasındaki referans kodu veya bağlantısıyla arkadaşlarını davet eder.",
        why: "Tedavi görmüş hastalardan gelen tavsiye soğuk iletişimden daha iyi dönüşür.",
        how: [
          "Settings'te Referral Discount ayarlandığından emin olun.",
          "Başarılı tedaviden sonra onaylı hastalara referans programından bahsedin.",
          "Hastalar uygulamada referans bağlantılarını bulur ve WhatsApp veya sosyal medyada paylaşır.",
          "Yeni hastaları her zamanki gibi Patients altında onaylayın."
        ],
        linkLabel: "Invite Patients'ı aç",
      },
      "referral-benefits": {
        title: "Klinikler referanslardan nasıl faydalanır",
        what: "Klinikler referanslarla daha fazla hasta, daha düşük pazarlama maliyeti ve arkadaş tavsiyesinden gelen daha yüksek güven kazanır.",
        why: "Referansla gelen hastalar gelmeden önce kliniğinize zaten güvenir. Genellikle tedavi planlarını daha hızlı kabul ederler.",
        how: [
          "Referrals sayfasında bekleyen ve tamamlanan referansları izleyin.",
          "Referansla gelen hastaları hızlı onaylayın.",
          "Faturalandırmada Settings kurallarınıza göre indirimleri uygulayın.",
          "Davet eden hastalara teşekkür edin — bu daha fazla daveti teşvik eder."
        ],
        linkLabel: "Referrals'ı aç",
      },
      "faq-clinic-code": {
        title: "Clinic Code nedir?",
        what: "Clinic Code, kliniğinizin kayıtta seçtiği kısa bir kelimedir (örneğin klinik adınız veya kısaltması).",
        why: "Doktorlar ve hastalar mobil uygulamada kliniğinize bağlanmak için aynı kodu kullanır.",
        how: [
          "Register Clinic'te siz oluşturursunuz — Clinifly size e-postayla kod göndermez.",
          "Doktorlarla paylaşın ve hastalar için resepsiyonda gösterin.",
          "Unuttuysanız hesabı kimin kaydettiğini kontrol edin veya Clinifly desteğine ulaşın."
        ],
      },
      "faq-doctor-or-ai": {
        title: "Doktor mu AI mi — kim yanıt verir?",
        what: "Onaylı doktorlarınız ve AI ikisi de hasta mesajlarına yanıt verebilir.",
        why: "Otomasyon ile kişisel bakım arasındaki dengeyi siz seçersiniz.",
        how: [
          "Doctors altında doktorları onaylayın, Lead inbox'ta atayın.",
          "Settings → AI Communication: Instant (AI önce), Wait for human veya Human-only.",
          "Doktorlar mobil uygulamadan yanıtlar; AI WhatsApp/Messenger'da otomatik yanıtlar."
        ],
        linkLabel: "Settings'i aç",
      },
      "faq-profile-vs-settings": {
        title: "Directory Profile vs Settings",
        what: "Settings arka ofisinizdir (fiyatlar, AI, adres). Directory Profile hasta araması için herkese açık vitrininizdir.",
        why: "İkisini karıştırmak en yaygın kurulum hatasıdır — hastalar Settings'i görmez, yalnızca Directory Profile'ı görür.",
        how: [
          "Settings: dahili klinik bilgisi, Treatment Price List, AI Communication, WhatsApp/Messenger.",
          "Directory Profile: logo, açıklama, fotoğraflar, uzmanlıklar, diller, Google yorumları, sosyal bağlantılar, yayın anahtarı.",
          "Tam çalışan bir klinik için ikisini de tamamlayın."
        ],
        linkLabel: "Directory Profile'ı aç",
      },
      "faq-setup-order": {
        title: "Önerilen kurulum sırası",
        what: "Önerilen kurulum sırası sizi en hızlı şekilde hasta almaya götürür.",
        why: "Sırayı takip etmek yeniden işi önler — örneğin fiyatlar ayarlanmadan WhatsApp bağlamak yanlış AI fiyatlarına yol açar.",
        how: [
          "1. Register → Login",
          "2. Settings: klinik bilgisi, AI Training, Treatment Price List",
          "3. Directory Profile: tamamlayın ve yayınlayın",
          "4. Doctors: uygulamada onaylayın → Lead inbox'ta atayın",
          "5. WhatsApp ve/veya Messenger'ı bağlayın",
          "6. Invite Patients bağlantısını paylaşın"
        ],
        linkLabel: "Tam rehberi görüntüle",
      },
      "faq-support": {
        title: "Clinifly desteğine ulaşın",
        what: "Clinifly müşteri desteği hesap sorunları, Meta/WhatsApp bağlantısı ve kurulum engellerinde yardımcı olur.",
        why: "Bazı adımlar (Meta Business doğrulaması, webhook sorunları) birebir yardım gerektirir.",
        how: [
          "support@clinifly.net adresine klinik adınız ve yönetici e-postanızla yazın.",
          "Takıldığınız ekranı açıklayın ve mümkünse ekran görüntüleri ekleyin.",
          "Eğitim videolarını https://www.youtube.com/@Clinifly adresinde izleyin"
        ],
      },
      "faq-videos": {
        title: "YouTube'da eğitim videoları",
        what: "Clinifly YouTube'da kayıt, Settings, AI ve kanal kurulumunu kapsayan adım adım eğitim videoları yayınlar.",
        why: "Videolar tam yönetici ekranlarını gösterir — okumaktan çok izlemeyi tercih ediyorsanız faydalıdır.",
        how: [
          "Açın: https://www.youtube.com/@Clinifly",
          "Sorunuza uygun videoyu bulun (kayıt, Directory Profile, WhatsApp vb.).",
          "Yönetici panelinizde eşzamanlı takip edin."
        ],
        linkLabel: "YouTube eğitimlerini aç",
      },
    },
  };
})(typeof window !== "undefined" ? window : global);
